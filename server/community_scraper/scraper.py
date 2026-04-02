"""
커뮤니티 핫게시글 스크래퍼
10개 한국 커뮤니티 사이트의 인기/핫 게시글을 병렬 수집
"""

import re
import time
import logging
from datetime import datetime, timezone, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

import requests
from bs4 import BeautifulSoup

from .cache import cache

logger = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
}

REQUEST_TIMEOUT = 10


def _parse_number(text: str | None) -> int:
    """Parse Korean number strings like '1.2만', '3,456' to int."""
    if not text:
        return 0
    text = text.strip().replace(",", "").replace(" ", "")
    if "만" in text:
        try:
            return int(float(text.replace("만", "")) * 10000)
        except ValueError:
            return 0
    if "억" in text:
        try:
            return int(float(text.replace("억", "")) * 100000000)
        except ValueError:
            return 0
    m = re.search(r"\d+", text)
    return int(m.group()) if m else 0


def _get_soup(url: str, encoding: str | None = None) -> BeautifulSoup | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        if encoding:
            resp.encoding = encoding
        elif resp.apparent_encoding:
            resp.encoding = resp.apparent_encoding
        return BeautifulSoup(resp.text, "lxml")
    except Exception as e:
        logger.warning("Failed to fetch %s: %s", url, e)
        return None


_KST = timezone(timedelta(hours=9))
MAX_AGE_DAYS = 2


def _parse_date(text: str | None) -> str | None:
    """다양한 한국 커뮤니티 날짜 형식을 ISO 문자열로 변환."""
    if not text:
        return None
    text = text.strip()
    now = datetime.now(_KST)

    # 시간만 있으면 오늘 (예: "15:42:11", "15:42")
    m = re.match(r"^(\d{1,2}):(\d{2})(:\d{2})?$", text)
    if m:
        return now.replace(hour=int(m.group(1)), minute=int(m.group(2)), second=0).isoformat()

    # "N분 전", "N시간 전", "N일 전"
    m = re.search(r"(\d+)\s*(분|시간|일)\s*전", text)
    if m:
        val, unit = int(m.group(1)), m.group(2)
        delta = {"분": timedelta(minutes=val), "시간": timedelta(hours=val), "일": timedelta(days=val)}
        return (now - delta.get(unit, timedelta())).isoformat()

    for fmt in (
        "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d",
        "%Y.%m.%d %H:%M:%S", "%Y.%m.%d %H:%M", "%Y.%m.%d",
        "%y/%m/%d %H:%M", "%y/%m/%d",
    ):
        try:
            return datetime.strptime(text, fmt).replace(tzinfo=_KST).isoformat()
        except ValueError:
            continue

    # "MM-DD" 또는 "MM.DD" (올해로 간주, 미래면 작년)
    m = re.match(r"^(\d{1,2})[-./ ](\d{1,2})$", text)
    if m:
        dt = now.replace(month=int(m.group(1)), day=int(m.group(2)), hour=0, minute=0, second=0, microsecond=0)
        if dt > now:
            dt = dt.replace(year=dt.year - 1)
        return dt.isoformat()

    return None


def _is_too_old(ts: str | None) -> bool:
    """timestamp가 MAX_AGE_DAYS보다 오래되었거나 미래면 True."""
    if not ts:
        return False  # 날짜 없으면 일단 포함
    try:
        dt = datetime.fromisoformat(ts)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=_KST)
        diff = (datetime.now(_KST) - dt).days
        return diff > MAX_AGE_DAYS or diff < -1  # 미래 날짜도 제외
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Individual scrapers
# ---------------------------------------------------------------------------

def _scrape_dcinside() -> list[dict]:
    """디시인사이드 실시간 베스트 (데스크톱)"""
    posts = []
    soup = _get_soup("https://gall.dcinside.com/board/lists/?id=dcbest&page=1")
    if not soup:
        return posts
    items = soup.select("tbody tr.us-post")
    for rank, item in enumerate(items[:30], 1):
        a = item.select_one("td.gall_tit a:not(.reply_numbox)")
        if not a:
            continue
        title = a.get_text(strip=True)
        if not title or len(title) < 2:
            continue
        href = a.get("href", "")
        if href and not href.startswith("http"):
            href = "https://gall.dcinside.com" + href

        view_count = 0
        comment_count = 0
        view_el = item.select_one("td.gall_count")
        if view_el:
            view_count = _parse_number(view_el.get_text())
        reply_el = item.select_one("a.reply_numbox")
        if reply_el:
            comment_count = _parse_number(reply_el.get_text())

        timestamp = None
        date_el = item.select_one("td.gall_date")
        if date_el:
            raw = date_el.get("title") or date_el.get_text(strip=True)
            timestamp = _parse_date(raw)

        posts.append({
            "rank": rank,
            "title": title,
            "url": href,
            "source": "디시인사이드",
            "source_id": "dcinside",
            "category": "유머",
            "view_count": view_count,
            "comment_count": comment_count,
            "timestamp": timestamp,
        })
    return posts


def _scrape_fmkorea() -> list[dict]:
    """에펨코리아 베스트2 (Playwright로 보안 우회)"""
    posts = []
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        logger.warning("playwright not installed, skipping fmkorea")
        return posts
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            page.goto("https://www.fmkorea.com/best2", wait_until="networkidle", timeout=20000)
            html = page.content()
            browser.close()
    except Exception as e:
        logger.warning("Failed to fetch fmkorea via playwright: %s", e)
        return posts

    soup = BeautifulSoup(html, "lxml")
    items = soup.select("li.li")
    for rank, item in enumerate(items[:30], 1):
        a = item.select_one("a.hotdeal_var8")
        if not a:
            continue
        title_el = a.select_one("span.ellipsis-target")
        title = title_el.get_text(strip=True) if title_el else a.get_text(strip=True)
        if not title or len(title) < 2:
            continue
        title = re.sub(r"\s*\[\d+\]\s*$", "", title)
        href = a.get("href", "")
        if href and not href.startswith("http"):
            href = "https://www.fmkorea.com" + href

        comment_count = 0
        cmt_el = item.select_one("span.comment_count")
        if cmt_el:
            comment_count = _parse_number(cmt_el.get_text())

        view_count = 0
        vote_el = item.select_one("span.count")
        if vote_el:
            view_count = _parse_number(vote_el.get_text())

        timestamp = None
        date_el = item.select_one("span.regdate")
        if date_el:
            timestamp = _parse_date(date_el.get_text(strip=True))

        posts.append({
            "rank": rank,
            "title": title,
            "url": href,
            "source": "에펨코리아",
            "source_id": "fmkorea",
            "category": "유머",
            "view_count": view_count,
            "comment_count": comment_count,
            "timestamp": timestamp,
        })
    return posts


def _scrape_ruliweb() -> list[dict]:
    """루리웹 베스트"""
    posts = []
    soup = _get_soup("https://bbs.ruliweb.com/best/all")
    if not soup:
        return posts
    items = soup.select("table.board_list_table tr.table_body, div.board_main .card_item")
    for rank, item in enumerate(items[:30], 1):
        a = item.select_one("a.deco, a.title_wrapper, a.subject_link")
        if not a:
            a = item.select_one("a")
        if not a:
            continue
        title = a.get_text(strip=True)
        if not title or len(title) < 2:
            continue
        href = a.get("href", "")
        if href and not href.startswith("http"):
            href = "https://bbs.ruliweb.com" + href

        view_count = 0
        comment_count = 0
        hit_el = item.select_one("td.hit, span.hit")
        if hit_el:
            view_count = _parse_number(hit_el.get_text())
        reply_el = item.select_one("a.num_reply span, span.reply_count")
        if reply_el:
            comment_count = _parse_number(reply_el.get_text())

        timestamp = None
        date_el = item.select_one("td.time, span.time")
        if date_el:
            timestamp = _parse_date(date_el.get_text(strip=True))

        posts.append({
            "rank": rank,
            "title": title,
            "url": href,
            "source": "루리웹",
            "source_id": "ruliweb",
            "category": "게임",
            "view_count": view_count,
            "comment_count": comment_count,
            "timestamp": timestamp,
        })
    return posts


def _scrape_theqoo() -> list[dict]:
    """더쿠 핫토픽"""
    posts = []
    soup = _get_soup("https://theqoo.net/hot")
    if not soup:
        return posts
    items = soup.select("table.theqoo_board_table tbody tr, div.board_list .li")
    for rank, item in enumerate(items[:30], 1):
        a = item.select_one("a.hx, td.title a, a")
        if not a:
            continue
        title = a.get_text(strip=True)
        if not title or len(title) < 2:
            continue
        href = a.get("href", "")
        if href and not href.startswith("http"):
            href = "https://theqoo.net" + href

        view_count = 0
        comment_count = 0
        hit_el = item.select_one("td.m_no_int:nth-of-type(4), span.count")
        if hit_el:
            view_count = _parse_number(hit_el.get_text())
        reply_el = item.select_one("td.m_no_int:nth-of-type(3), span.reply_count")
        if reply_el:
            comment_count = _parse_number(reply_el.get_text())

        timestamp = None
        date_el = item.select_one("td.m_no:last-of-type, span.date, td.time")
        if date_el:
            timestamp = _parse_date(date_el.get_text(strip=True))

        posts.append({
            "rank": rank,
            "title": title,
            "url": href,
            "source": "더쿠",
            "source_id": "theqoo",
            "category": "연예",
            "view_count": view_count,
            "comment_count": comment_count,
            "timestamp": timestamp,
        })
    return posts


def _scrape_arca_live() -> list[dict]:
    """아카라이브 속보 채널"""
    posts = []
    soup = _get_soup("https://arca.live/b/breaking")
    if not soup:
        return posts
    items = soup.select("a.vrow-top, a[class*='vrow']")
    for rank, item in enumerate(items[:40], 1):
        href = item.get("href", "")
        # 광고/공지 제외
        if not href or not re.search(r"/b/breaking/\d+", href):
            continue
        if not href.startswith("http"):
            href = "https://arca.live" + href
        title_el = item.select_one("span.title")
        title = title_el.get_text(strip=True) if title_el else item.get_text(strip=True)
        if not title or len(title) < 2:
            continue

        view_count = 0
        comment_count = 0
        vcnt = item.select_one("span.vcnt")
        if vcnt:
            view_count = _parse_number(vcnt.get_text())
        reply_el = item.select_one("span.comment-count")
        if reply_el:
            comment_count = _parse_number(reply_el.get_text())

        timestamp = None
        time_el = item.select_one("time")
        if time_el:
            raw = time_el.get("datetime") or time_el.get_text(strip=True)
            timestamp = _parse_date(raw)

        if len(posts) >= 30:
            break
        posts.append({
            "rank": len(posts) + 1,
            "title": title,
            "url": href,
            "source": "아카라이브",
            "source_id": "arca_live",
            "category": "게임",
            "view_count": view_count,
            "comment_count": comment_count,
            "timestamp": timestamp,
        })
    return posts


def _scrape_inven() -> list[dict]:
    """인벤 오이갤(웹진 유머)"""
    posts = []
    soup = _get_soup("https://www.inven.co.kr/board/webzine/2097")
    if not soup:
        return posts
    rows = soup.select("table.thumbnail tr")
    seen = set()
    for row in rows:
        a = row.select_one("a[href*='/board/webzine/2097/']")
        if not a:
            continue
        title = a.get_text(strip=True)
        if not title or len(title) < 2 or title in seen:
            continue
        seen.add(title)
        href = a.get("href", "")
        if href and not href.startswith("http"):
            href = "https://www.inven.co.kr" + href

        tds = row.select("td")
        # tds: [카테고리, 제목, 글쓴이, 날짜, 조회수, 댓글수]
        view_count = 0
        comment_count = 0
        timestamp = None
        if len(tds) >= 6:
            view_count = _parse_number(tds[4].get_text())
            comment_count = _parse_number(tds[5].get_text())
            timestamp = _parse_date(tds[3].get_text(strip=True))

        # 공지는 조회수가 100만+ → 스킵
        if view_count > 500000:
            continue

        if len(posts) >= 30:
            break
        posts.append({
            "rank": len(posts) + 1,
            "title": title,
            "url": href,
            "source": "인벤",
            "source_id": "inven",
            "category": "게임",
            "view_count": view_count,
            "comment_count": comment_count,
            "timestamp": timestamp,
        })
    return posts


def _scrape_ppomppu() -> list[dict]:
    """뽐뿌 핫게시글"""
    posts = []
    soup = _get_soup("https://www.ppomppu.co.kr/hot.php", encoding="euc-kr")
    if not soup:
        return posts
    items = soup.select("table.board_table tr")
    for item in items:
        tds = item.select("td")
        # 데이터 행: 7개 td [게시판, 아이콘, 제목+댓글, 글쓴이, 등록일, 추천, 조회수]
        if len(tds) < 7:
            continue
        # 제목은 3번째 td (index 2) 안의 마지막 a 태그 (앞 두개는 아이콘)
        title_td = tds[2]
        links = title_td.select("a")
        a = None
        for link in reversed(links):
            if link.get_text(strip=True):
                a = link
                break
        if not a:
            continue
        title = a.get_text(strip=True)
        if not title or len(title) < 2:
            continue
        # 댓글수 추출 (제목 옆 숫자)
        comment_count = 0
        cm = re.search(r"(\d+)\s*$", title_td.get_text(strip=True))
        if cm:
            comment_count = int(cm.group(1))
            title = re.sub(r"\s*\d+\s*$", "", title)

        href = a.get("href", "")
        if href and not href.startswith("http"):
            href = "https://www.ppomppu.co.kr" + href

        view_count = _parse_number(tds[6].get_text())
        timestamp = _parse_date(tds[4].get_text(strip=True))

        if len(posts) >= 30:
            break
        posts.append({
            "rank": len(posts) + 1,
            "title": title,
            "url": href,
            "source": "뽐뿌",
            "source_id": "ppomppu",
            "category": "쇼핑/생활",
            "view_count": view_count,
            "comment_count": comment_count,
            "timestamp": timestamp,
        })
    return posts


def _scrape_mlbpark() -> list[dict]:
    """엠팍 불펜"""
    posts = []
    soup = _get_soup("https://mlbpark.donga.com/mp/b.php?b=bullpen")
    if not soup:
        return posts
    items = soup.select("table.tbl_type01 tbody tr")
    for item in items:
        tds = item.select("td")
        if len(tds) < 5:
            continue
        # 공지 스킵
        if tds[0].get_text(strip=True) == "공지":
            continue
        # 제목: a.txt
        a = item.select_one("a.txt")
        if not a:
            continue
        title = a.get_text(strip=True)
        if not title or len(title) < 2:
            continue
        href = a.get("href", "")
        if href and not href.startswith("http"):
            href = "https://mlbpark.donga.com" + href

        view_count = _parse_number(tds[4].get_text())
        comment_count = 0
        reply_el = item.select_one("a.replycnt")
        if reply_el:
            comment_count = _parse_number(reply_el.get_text())

        timestamp = _parse_date(tds[3].get_text(strip=True))

        if len(posts) >= 30:
            break
        posts.append({
            "rank": len(posts) + 1,
            "title": title,
            "url": href,
            "source": "엠팍",
            "source_id": "mlbpark",
            "category": "스포츠",
            "view_count": view_count,
            "comment_count": comment_count,
            "timestamp": timestamp,
        })
    return posts


def _scrape_clien() -> list[dict]:
    """클리앙 인기글"""
    posts = []
    soup = _get_soup("https://www.clien.net/service/board/park")
    if not soup:
        return posts
    items = soup.select("div.list_item, div.content_item")
    for rank, item in enumerate(items[:30], 1):
        a = item.select_one("a.list_subject, a.subject_fixed")
        if not a:
            a = item.select_one("a")
        if not a:
            continue
        title_el = a.select_one("span.subject_fixed")
        title = title_el.get_text(strip=True) if title_el else a.get_text(strip=True)
        if not title or len(title) < 2:
            continue
        href = a.get("href", "")
        if href and not href.startswith("http"):
            href = "https://www.clien.net" + href

        view_count = 0
        comment_count = 0
        hit_el = item.select_one("span.hit, .view_count")
        if hit_el:
            view_count = _parse_number(hit_el.get_text())
        reply_el = item.select_one("span.rSymph05, .reply_symph")
        if reply_el:
            comment_count = _parse_number(reply_el.get_text())

        timestamp = None
        date_el = item.select_one("span.timestamp, span.time")
        if date_el:
            raw = date_el.get("title") or date_el.get_text(strip=True)
            timestamp = _parse_date(raw)

        posts.append({
            "rank": rank,
            "title": title,
            "url": href,
            "source": "클리앙",
            "source_id": "clien",
            "category": "테크",
            "view_count": view_count,
            "comment_count": comment_count,
            "timestamp": timestamp,
        })
    return posts


def _scrape_nate_pann() -> list[dict]:
    """네이트 판 인기글"""
    posts = []
    soup = _get_soup("https://pann.nate.com/talk/ranking")
    if not soup:
        return posts
    items = soup.select("ul.post_wrap li, div.post_list li, div.rankingList li")
    for rank, item in enumerate(items[:30], 1):
        a = item.select_one("a.tit, a.title, a")
        if not a:
            continue
        title = a.get_text(strip=True)
        if not title or len(title) < 2:
            continue
        href = a.get("href", "")
        if href and not href.startswith("http"):
            href = "https://pann.nate.com" + href

        view_count = 0
        comment_count = 0
        count_el = item.select_one("span.count, span.cnt")
        if count_el:
            view_count = _parse_number(count_el.get_text())
        reply_el = item.select_one("span.reply, em.reply")
        if reply_el:
            comment_count = _parse_number(reply_el.get_text())

        timestamp = None
        date_el = item.select_one("span.date, span.time")
        if date_el:
            timestamp = _parse_date(date_el.get_text(strip=True))

        posts.append({
            "rank": rank,
            "title": title,
            "url": href,
            "source": "네이트 판",
            "source_id": "nate_pann",
            "category": "이슈",
            "view_count": view_count,
            "comment_count": comment_count,
            "timestamp": timestamp,
        })
    return posts


# ---------------------------------------------------------------------------
# Phase 2 — 추가 12개 커뮤니티
# ---------------------------------------------------------------------------

def _scrape_ilbe() -> list[dict]:
    """일베 일간베스트"""
    posts = []
    soup = _get_soup("https://www.ilbe.com/list/ilbe")
    if not soup:
        return posts
    items = soup.select("div.board-list-item, tr.board-list-item")
    for rank, item in enumerate(items[:30], 1):
        a = item.select_one("a.title, a")
        if not a:
            continue
        title = a.get_text(strip=True)
        if not title or len(title) < 2:
            continue
        href = a.get("href", "")
        if href and not href.startswith("http"):
            href = "https://www.ilbe.com" + href
        view_count = comment_count = 0
        view_el = item.select_one("span.count, span.view, td.view")
        if view_el:
            view_count = _parse_number(view_el.get_text())
        reply_el = item.select_one("span.reply, span.cmt")
        if reply_el:
            comment_count = _parse_number(reply_el.get_text())
        posts.append({"rank": rank, "title": title, "url": href, "source": "일베", "source_id": "ilbe", "category": "이슈", "view_count": view_count, "comment_count": comment_count, "timestamp": None})
    return posts


def _scrape_instiz() -> list[dict]:
    """인스티즈 핫이슈"""
    posts = []
    soup = _get_soup("https://www.instiz.net/pt")
    if not soup:
        return posts
    items = soup.select("div#mainboard tbody tr, table.notice tbody tr")
    for rank, item in enumerate(items[:30], 1):
        a = item.select_one("a.title, td.title a, a")
        if not a:
            continue
        title = a.get_text(strip=True)
        if not title or len(title) < 2:
            continue
        href = a.get("href", "")
        if href and not href.startswith("http"):
            href = "https://www.instiz.net" + href
        view_count = comment_count = 0
        view_el = item.select_one("td.view, span.hit")
        if view_el:
            view_count = _parse_number(view_el.get_text())
        reply_el = item.select_one("span.cmt, span.reply_count")
        if reply_el:
            comment_count = _parse_number(reply_el.get_text())
        posts.append({"rank": rank, "title": title, "url": href, "source": "인스티즈", "source_id": "instiz", "category": "연예", "view_count": view_count, "comment_count": comment_count, "timestamp": None})
    return posts


def _scrape_bobaedream() -> list[dict]:
    """보배드림 베스트"""
    posts = []
    soup = _get_soup("https://www.bobaedream.co.kr/list?code=best")
    if not soup:
        return posts
    items = soup.select("tbody tr")
    for rank, item in enumerate(items[:30], 1):
        a = item.select_one("td.pl14 a")
        if not a:
            continue
        title = a.get_text(strip=True)
        if not title or len(title) < 2:
            continue
        href = a.get("href", "")
        if href and not href.startswith("http"):
            href = "https://www.bobaedream.co.kr" + href
        view_count = comment_count = 0
        view_el = item.select_one("td.count")
        if view_el:
            view_count = _parse_number(view_el.get_text())
        # 댓글수는 제목 옆 (숫자) 형태
        td_pl14 = item.select_one("td.pl14")
        if td_pl14:
            cm = re.search(r"\((\d+)\)", td_pl14.get_text())
            if cm:
                comment_count = int(cm.group(1))
        timestamp = None
        date_el = item.select_one("td.date")
        if date_el:
            timestamp = _parse_date(date_el.get_text(strip=True))
        posts.append({"rank": rank, "title": title, "url": href, "source": "보배드림", "source_id": "bobaedream", "category": "자동차", "view_count": view_count, "comment_count": comment_count, "timestamp": timestamp})
    return posts


def _scrape_etoland() -> list[dict]:
    """이토랜드 인기글 (hit.php)"""
    posts = []
    soup = _get_soup("https://www.etoland.co.kr/bbs/hit.php", encoding="euc-kr")
    if not soup:
        return posts
    # class 없는 article 안의 li가 인기글 30개
    articles = soup.select("article")
    target = None
    for art in articles:
        cls = art.get("class", [])
        if not cls:  # class 없는 article
            target = art
            break
    if not target:
        return posts
    items = target.select("li")
    for item in items[:30]:
        a = item.select_one("a")
        if not a:
            continue
        text = a.get_text(strip=True)
        if not text or len(text) < 3:
            continue
        # "1교도소 출소시..." 형태 → 앞 숫자 제거
        text = re.sub(r"^\d+", "", text)
        # "(60)" 형태 댓글수 추출 후 제거
        comment_count = 0
        cm = re.search(r"\((\d+)\)\s*$", text)
        if cm:
            comment_count = int(cm.group(1))
            text = re.sub(r"\s*\(\d+\)\s*$", "", text)
        title = text.strip()
        if not title or len(title) < 2:
            continue
        href = a.get("href", "")
        if href and not href.startswith("http"):
            href = "https://www.etoland.co.kr/" + href.lstrip("./").lstrip("/")
        posts.append({"rank": len(posts) + 1, "title": title, "url": href, "source": "이토랜드", "source_id": "etoland", "category": "유머", "view_count": 0, "comment_count": comment_count, "timestamp": None})
    return posts


def _scrape_humoruniv() -> list[dict]:
    """웃긴대학 베스트 (euc-kr 인코딩)"""
    posts = []
    try:
        resp = requests.get(
            "https://web.humoruniv.com/board/humor/list.html?table=pds&st=day",
            headers=HEADERS, timeout=REQUEST_TIMEOUT,
        )
        resp.raise_for_status()
        resp.encoding = "euc-kr"
        soup = BeautifulSoup(resp.text, "lxml")
    except Exception as e:
        logger.warning("Failed to fetch humoruniv: %s", e)
        return posts
    items = soup.select("table#post_list tr[id^='li_chk_pds-']")
    for rank, item in enumerate(items[:30], 1):
        title_el = item.select_one("td.li_sbj a.li span[id^='title_chk_pds-']")
        if not title_el:
            continue
        title = title_el.get_text(strip=True)
        if not title or len(title) < 2:
            continue
        a = item.select_one("td.li_sbj a.li")
        href = a.get("href", "") if a else ""
        if href and not href.startswith("http"):
            href = "https://web.humoruniv.com/board/humor/" + href.lstrip("./")
        view_count = comment_count = 0
        # 조회수: 5번째 td (li_und 중 첫 번째)
        tds = item.select("td.li_und")
        if tds:
            view_count = _parse_number(tds[0].get_text())
        cmt_el = item.select_one("span.list_comment_num")
        if cmt_el:
            comment_count = _parse_number(cmt_el.get_text())
        timestamp = None
        date_el = item.select_one("td.li_date span.w_date")
        time_el = item.select_one("td.li_date span.w_time")
        if date_el and time_el:
            timestamp = _parse_date(date_el.get_text(strip=True) + " " + time_el.get_text(strip=True))
        elif date_el:
            timestamp = _parse_date(date_el.get_text(strip=True))
        posts.append({"rank": rank, "title": title, "url": href, "source": "웃긴대학", "source_id": "humoruniv", "category": "유머", "view_count": view_count, "comment_count": comment_count, "timestamp": timestamp})
    return posts


def _scrape_82cook() -> list[dict]:
    """82쿡 자유게시판"""
    posts = []
    soup = _get_soup("https://www.82cook.com/entiz/enti.php?bn=15")
    if not soup:
        return posts
    items = soup.select("tbody tr")
    count = 0
    for item in items:
        a = item.select_one("td.title a:not(.bbs_title_word)")
        if not a:
            continue
        title = a.get_text(strip=True)
        if not title or len(title) < 2:
            continue
        href = a.get("href", "")
        if href and not href.startswith("http"):
            href = "https://www.82cook.com/entiz/" + href.lstrip("./")
        view_count = comment_count = 0
        view_el = item.select_one("td.numbers:last-child")
        if view_el:
            view_count = _parse_number(view_el.get_text())
        cmt_el = item.select_one("td.title em")
        if cmt_el:
            comment_count = _parse_number(cmt_el.get_text())
        count += 1
        if count > 30:
            break
        timestamp = None
        date_el = item.select_one("td.regdate")
        if date_el:
            raw = date_el.get("title") or date_el.get_text(strip=True)
            timestamp = _parse_date(raw)
        posts.append({"rank": count, "title": title, "url": href, "source": "82쿡", "source_id": "82cook", "category": "쇼핑/생활", "view_count": view_count, "comment_count": comment_count, "timestamp": timestamp})
    return posts


def _scrape_slrclub() -> list[dict]:
    """SLR클럽 추천게시물"""
    posts = []
    soup = _get_soup("https://www.slrclub.com/bbs/zboard.php?id=best_article")
    if not soup:
        return posts
    items = soup.select("tbody tr")
    for rank, item in enumerate(items[:30], 1):
        sbj_td = item.select_one("td.sbj")
        if not sbj_td:
            continue
        a = sbj_td.select_one("a")
        if not a:
            continue
        # 제목에서 [댓글수] 제거
        full_text = sbj_td.get_text(strip=True)
        cm = re.search(r"\[(\d+)\]$", full_text)
        comment_count = int(cm.group(1)) if cm else 0
        title = a.get_text(strip=True)
        if not title or len(title) < 2:
            continue
        href = a.get("href", "")
        if href and not href.startswith("http"):
            href = "https://www.slrclub.com" + href
        view_count = 0
        view_el = item.select_one("td.list_click")
        if view_el:
            view_count = _parse_number(view_el.get_text())
        timestamp = None
        date_el = item.select_one("td.list_date")
        if date_el:
            timestamp = _parse_date(date_el.get_text(strip=True))
        posts.append({"rank": rank, "title": title, "url": href, "source": "SLR클럽", "source_id": "slrclub", "category": "테크", "view_count": view_count, "comment_count": comment_count, "timestamp": timestamp})
    return posts


def _scrape_damoang() -> list[dict]:
    """다모앙 인기글"""
    posts = []
    soup = _get_soup("https://damoang.net/bbs/best")
    if not soup:
        return posts
    items = soup.select("div.board-list-body div.list-item, table.board_list tbody tr")
    for rank, item in enumerate(items[:30], 1):
        a = item.select_one("a.subject-link, a.title, a")
        if not a:
            continue
        title = a.get_text(strip=True)
        if not title or len(title) < 2:
            continue
        href = a.get("href", "")
        if href and not href.startswith("http"):
            href = "https://damoang.net" + href
        view_count = comment_count = 0
        view_el = item.select_one("span.hit, span.view")
        if view_el:
            view_count = _parse_number(view_el.get_text())
        reply_el = item.select_one("span.reply, span.cmt")
        if reply_el:
            comment_count = _parse_number(reply_el.get_text())
        posts.append({"rank": rank, "title": title, "url": href, "source": "다모앙", "source_id": "damoang", "category": "쇼핑/생활", "view_count": view_count, "comment_count": comment_count, "timestamp": None})
    return posts


def _scrape_gasengi() -> list[dict]:
    """가생이닷컴 자유토론"""
    posts = []
    soup = _get_soup("https://www.gasengi.com/main/board.php?bo_table=commu08")
    if not soup:
        return posts
    items = soup.select("tbody tr:not(.table-primary)")
    for rank, item in enumerate(items[:30], 1):
        a = item.select_one("a.link-body-emphasis")
        if not a:
            continue
        title = a.get_text(strip=True)
        if not title or len(title) < 2:
            continue
        href = a.get("href", "")
        if href and not href.startswith("http"):
            href = "https://www.gasengi.com" + href
        view_count = comment_count = 0
        tds = item.select("td")
        if len(tds) >= 4:
            view_count = _parse_number(tds[3].get_text())
        badge = item.select_one("span.badge")
        if badge:
            comment_count = _parse_number(badge.get_text())
        timestamp = None
        if len(tds) >= 5:
            timestamp = _parse_date(tds[4].get_text(strip=True))
        posts.append({"rank": rank, "title": title, "url": href, "source": "가생이", "source_id": "gasengi", "category": "이슈", "view_count": view_count, "comment_count": comment_count, "timestamp": timestamp})
    return posts


def _scrape_orbi() -> list[dict]:
    """오르비 핫게시판"""
    posts = []
    soup = _get_soup("https://orbi.kr/bbs/board/hot")
    if not soup:
        return posts
    items = soup.select("div.board-list-item, div.list-item, tr.board-item")
    for rank, item in enumerate(items[:30], 1):
        a = item.select_one("a.title, a.subject, a")
        if not a:
            continue
        title = a.get_text(strip=True)
        if not title or len(title) < 2:
            continue
        href = a.get("href", "")
        if href and not href.startswith("http"):
            href = "https://orbi.kr" + href
        view_count = comment_count = 0
        view_el = item.select_one("span.hit, span.view-count")
        if view_el:
            view_count = _parse_number(view_el.get_text())
        reply_el = item.select_one("span.reply-count, span.cmt")
        if reply_el:
            comment_count = _parse_number(reply_el.get_text())
        posts.append({"rank": rank, "title": title, "url": href, "source": "오르비", "source_id": "orbi", "category": "교육", "view_count": view_count, "comment_count": comment_count, "timestamp": None})
    return posts


def _scrape_todayhumor() -> list[dict]:
    """오늘의유머 베스트오브베스트"""
    posts = []
    try:
        resp = requests.get(
            "https://www.todayhumor.co.kr/board/list.php?table=bestofbest",
            headers=HEADERS, timeout=REQUEST_TIMEOUT,
        )
        resp.raise_for_status()
        resp.encoding = "utf-8"
        soup = BeautifulSoup(resp.text, "lxml")
    except Exception as e:
        logger.warning("Failed to fetch todayhumor: %s", e)
        return posts
    items = soup.select("table.table_list tr.view")
    for rank, item in enumerate(items[:30], 1):
        a = item.select_one("td.subject > a[href*='/board/view.php']")
        if not a:
            continue
        title = a.get_text(strip=True)
        if not title or len(title) < 2:
            continue
        href = a.get("href", "")
        if href and not href.startswith("http"):
            href = "https://www.todayhumor.co.kr" + href
        view_count = comment_count = 0
        view_el = item.select_one("td.hits")
        if view_el:
            view_count = _parse_number(view_el.get_text())
        cmt_el = item.select_one("span.list_memo_count_span")
        if cmt_el:
            comment_count = _parse_number(cmt_el.get_text())
        timestamp = None
        date_el = item.select_one("td.date")
        if date_el:
            timestamp = _parse_date(date_el.get_text(strip=True))
        posts.append({"rank": rank, "title": title, "url": href, "source": "오늘의유머", "source_id": "todayhumor", "category": "유머", "view_count": view_count, "comment_count": comment_count, "timestamp": timestamp})
    return posts


def _scrape_hygall() -> list[dict]:
    """해연갤 (디시 해외연예 갤러리) 베스트"""
    posts = []
    soup = _get_soup("https://gall.dcinside.com/mgallery/board/lists/?id=hy&sort_type=N&search_head=10")
    if not soup:
        return posts
    items = soup.select("table.gall_list tbody tr.ub-content, tr.us-post")
    for rank, item in enumerate(items[:30], 1):
        a = item.select_one("td.gall_tit a:not(.reply_numbox)")
        if not a:
            continue
        title = a.get_text(strip=True)
        if not title or len(title) < 2:
            continue
        href = a.get("href", "")
        if href and not href.startswith("http"):
            href = "https://gall.dcinside.com" + href
        view_count = comment_count = 0
        view_el = item.select_one("td.gall_count")
        if view_el:
            view_count = _parse_number(view_el.get_text())
        reply_el = item.select_one("a.reply_numbox")
        if reply_el:
            comment_count = _parse_number(reply_el.get_text())
        posts.append({"rank": rank, "title": title, "url": href, "source": "해연갤", "source_id": "hygall", "category": "연예", "view_count": view_count, "comment_count": comment_count, "timestamp": None})
    return posts


# ---------------------------------------------------------------------------
# Aggregator
# ---------------------------------------------------------------------------

SCRAPERS = [
    _scrape_dcinside,
    _scrape_ruliweb,
    _scrape_theqoo,
    _scrape_arca_live,
    _scrape_inven,
    _scrape_ppomppu,
    _scrape_mlbpark,
    _scrape_clien,
    _scrape_nate_pann,
    # Phase 2 (일베/인스티즈/오르비/다모앙/해연갤은 SPA/JS렌더링/차단으로 제외)
    _scrape_bobaedream,
    _scrape_etoland,
    _scrape_humoruniv,
    _scrape_82cook,
    _scrape_slrclub,
    _scrape_gasengi,
    _scrape_todayhumor,
]

# 공지/광고/이벤트 필터 패턴
_NOISE_PATTERNS = re.compile(
    r"^\[?\s*(공지|광고|이벤트|안내|필독|규칙|비밀번호|AD)\s*\]?"
    r"|◤.*규칙◢"
    r"|📢.*중요"
    r"|공지가 길다면"
    r"|언금\s*공지"
    r"|스퀘어 정치글",
    re.IGNORECASE,
)


def _is_noise(title: str) -> bool:
    """공지, 광고, 운영 게시글 필터."""
    return bool(_NOISE_PATTERNS.search(title))


def fetch_all_hot_posts(force: bool = False) -> dict[str, Any]:
    """
    모든 커뮤니티의 핫 게시글을 수집.
    캐시된 데이터가 있고 force=False이면 캐시 반환.
    """
    if not force:
        cached = cache.get()
        if cached is not None:
            return {**cached, "cached": True}

    all_posts: list[dict] = []

    with ThreadPoolExecutor(max_workers=22) as executor:
        futures = {executor.submit(fn): fn.__name__ for fn in SCRAPERS}
        for future in as_completed(futures):
            name = futures[future]
            try:
                posts = future.result(timeout=15)
                all_posts.extend(posts)
            except Exception as e:
                logger.warning("Scraper %s failed: %s", name, e)

    # 공지/광고 제거 + 오래된 게시글 제거 (2일 이내만)
    all_posts = [p for p in all_posts if not _is_noise(p["title"]) and not _is_too_old(p.get("timestamp"))]

    # 조회수 + 댓글수 기반 통합 랭킹 정렬 (댓글 가중치 ×10)
    all_posts.sort(key=lambda p: p["view_count"] + p["comment_count"] * 10, reverse=True)

    # 순위 재부여
    for i, p in enumerate(all_posts, 1):
        p["rank"] = i

    now = datetime.now(timezone.utc).isoformat()
    result = {
        "posts": all_posts,
        "cached": False,
        "updated_at": now,
    }
    cache.set(result)
    return result
