"""
Vercel Serverless Function: 커뮤니티 핫게시글 수집
10개 한국 커뮤니티 사이트의 인기/핫 게시글을 병렬 스크래핑
"""

from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import json
import re
import time
import logging
from datetime import datetime, timezone, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# In-memory cache (cold start마다 리셋)
# ---------------------------------------------------------------------------
_cache: dict | None = None
_cache_time: float = 0
CACHE_TTL = 3600  # 1 hour

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
}

REQUEST_TIMEOUT = 10


def _parse_number(text: str | None) -> int:
    if not text:
        return 0
    text = text.strip().replace(",", "").replace(" ", "")
    if "만" in text:
        try:
            return int(float(text.replace("만", "")) * 10000)
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
    if not text:
        return None
    text = text.strip()
    now = datetime.now(_KST)
    m = re.match(r"^(\d{1,2}):(\d{2})(:\d{2})?$", text)
    if m:
        return now.replace(hour=int(m.group(1)), minute=int(m.group(2)), second=0).isoformat()
    m = re.search(r"(\d+)\s*(분|시간|일)\s*전", text)
    if m:
        val, unit = int(m.group(1)), m.group(2)
        delta = {"분": timedelta(minutes=val), "시간": timedelta(hours=val), "일": timedelta(days=val)}
        return (now - delta.get(unit, timedelta())).isoformat()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d", "%Y.%m.%d %H:%M:%S", "%Y.%m.%d %H:%M", "%Y.%m.%d", "%y/%m/%d %H:%M", "%y/%m/%d"):
        try:
            return datetime.strptime(text, fmt).replace(tzinfo=_KST).isoformat()
        except ValueError:
            continue
    m = re.match(r"^(\d{1,2})[-./ ](\d{1,2})$", text)
    if m:
        dt = now.replace(month=int(m.group(1)), day=int(m.group(2)), hour=0, minute=0, second=0, microsecond=0)
        if dt > now:
            dt = dt.replace(year=dt.year - 1)
        return dt.isoformat()
    return None


def _is_too_old(ts: str | None) -> bool:
    if not ts:
        return False
    try:
        dt = datetime.fromisoformat(ts)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=_KST)
        diff = (datetime.now(_KST) - dt).days
        return diff > MAX_AGE_DAYS or diff < -1
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Scrapers (동일 로직 — server/community_scraper/scraper.py 미러)
# ---------------------------------------------------------------------------

def _scrape_dcinside() -> list[dict]:
    posts = []
    soup = _get_soup("https://gall.dcinside.com/board/lists/?id=dcbest&page=1")
    if not soup: return posts
    for rank, item in enumerate(soup.select("tbody tr.us-post")[:30], 1):
        a = item.select_one("td.gall_tit a:not(.reply_numbox)")
        if not a: continue
        title = a.get_text(strip=True)
        if not title or len(title) < 2: continue
        href = a.get("href", "")
        if href and not href.startswith("http"): href = "https://gall.dcinside.com" + href
        view_count = comment_count = 0
        v = item.select_one("td.gall_count")
        if v: view_count = _parse_number(v.get_text())
        r = item.select_one("a.reply_numbox")
        if r: comment_count = _parse_number(r.get_text())
        timestamp = None
        d = item.select_one("td.gall_date")
        if d:
            raw = d.get("title") or d.get_text(strip=True)
            timestamp = _parse_date(raw)
        posts.append({"rank": rank, "title": title, "url": href, "source": "디시인사이드", "source_id": "dcinside", "category": "유머", "view_count": view_count, "comment_count": comment_count, "timestamp": timestamp})
    return posts


def _scrape_fmkorea() -> list[dict]:
    """Vercel에서는 Playwright 사용 불가 → requests로 시도 (430이면 빈 결과)"""
    posts = []
    soup = _get_soup("https://www.fmkorea.com/best2")
    if not soup: return posts
    for rank, item in enumerate(soup.select("li.li")[:30], 1):
        a = item.select_one("a.hotdeal_var8")
        if not a: continue
        title_el = a.select_one("span.ellipsis-target")
        title = title_el.get_text(strip=True) if title_el else a.get_text(strip=True)
        if not title or len(title) < 2: continue
        title = re.sub(r"\s*\[\d+\]\s*$", "", title)
        href = a.get("href", "")
        if href and not href.startswith("http"): href = "https://www.fmkorea.com" + href
        comment_count = 0
        cmt_el = item.select_one("span.comment_count")
        if cmt_el: comment_count = _parse_number(cmt_el.get_text())
        view_count = 0
        vote_el = item.select_one("span.count")
        if vote_el: view_count = _parse_number(vote_el.get_text())
        timestamp = None
        d = item.select_one("span.regdate")
        if d: timestamp = _parse_date(d.get_text(strip=True))
        posts.append({"rank": rank, "title": title, "url": href, "source": "에펨코리아", "source_id": "fmkorea", "category": "유머", "view_count": view_count, "comment_count": comment_count, "timestamp": timestamp})
    return posts


def _scrape_ruliweb() -> list[dict]:
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
        view_count = comment_count = 0
        hit_el = item.select_one("td.hit, span.hit")
        if hit_el:
            view_count = _parse_number(hit_el.get_text())
        reply_el = item.select_one("a.num_reply span, span.reply_count")
        if reply_el:
            comment_count = _parse_number(reply_el.get_text())
        timestamp = None
        date_el = item.select_one("td.time, span.time")
        if date_el: timestamp = _parse_date(date_el.get_text(strip=True))
        posts.append({"rank": rank, "title": title, "url": href, "source": "루리웹", "source_id": "ruliweb", "category": "게임", "view_count": view_count, "comment_count": comment_count, "timestamp": timestamp})
    return posts


def _scrape_theqoo() -> list[dict]:
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
        view_count = comment_count = 0
        hit_el = item.select_one("td.m_no_int:nth-of-type(4), span.count")
        if hit_el:
            view_count = _parse_number(hit_el.get_text())
        reply_el = item.select_one("td.m_no_int:nth-of-type(3), span.reply_count")
        if reply_el:
            comment_count = _parse_number(reply_el.get_text())
        timestamp = None
        date_el = item.select_one("td.m_no:last-of-type, span.date, td.time")
        if date_el: timestamp = _parse_date(date_el.get_text(strip=True))
        posts.append({"rank": rank, "title": title, "url": href, "source": "더쿠", "source_id": "theqoo", "category": "연예", "view_count": view_count, "comment_count": comment_count, "timestamp": timestamp})
    return posts


def _scrape_arca_live() -> list[dict]:
    posts = []
    soup = _get_soup("https://arca.live/b/breaking")
    if not soup: return posts
    items = soup.select("a.vrow-top, a[class*='vrow']")
    for item in items[:40]:
        href = item.get("href", "")
        if not href or not re.search(r"/b/breaking/\d+", href): continue
        if not href.startswith("http"): href = "https://arca.live" + href
        title_el = item.select_one("span.title")
        title = title_el.get_text(strip=True) if title_el else item.get_text(strip=True)
        if not title or len(title) < 2: continue
        view_count = comment_count = 0
        vcnt = item.select_one("span.vcnt")
        if vcnt: view_count = _parse_number(vcnt.get_text())
        r = item.select_one("span.comment-count")
        if r: comment_count = _parse_number(r.get_text())
        timestamp = None
        t = item.select_one("time")
        if t:
            raw = t.get("datetime") or t.get_text(strip=True)
            timestamp = _parse_date(raw)
        if len(posts) >= 30: break
        posts.append({"rank": len(posts)+1, "title": title, "url": href, "source": "아카라이브", "source_id": "arca_live", "category": "게임", "view_count": view_count, "comment_count": comment_count, "timestamp": timestamp})
    return posts


def _scrape_inven() -> list[dict]:
    posts = []
    soup = _get_soup("https://www.inven.co.kr/board/webzine/2097")
    if not soup: return posts
    seen = set()
    for row in soup.select("table.thumbnail tr"):
        a = row.select_one("a[href*='/board/webzine/2097/']")
        if not a: continue
        title = a.get_text(strip=True)
        if not title or len(title) < 2 or title in seen: continue
        seen.add(title)
        href = a.get("href", "")
        if href and not href.startswith("http"): href = "https://www.inven.co.kr" + href
        tds = row.select("td")
        view_count = comment_count = 0
        timestamp = None
        if len(tds) >= 6:
            view_count = _parse_number(tds[4].get_text())
            comment_count = _parse_number(tds[5].get_text())
            timestamp = _parse_date(tds[3].get_text(strip=True))
        if view_count > 500000: continue
        if len(posts) >= 30: break
        posts.append({"rank": len(posts)+1, "title": title, "url": href, "source": "인벤", "source_id": "inven", "category": "게임", "view_count": view_count, "comment_count": comment_count, "timestamp": timestamp})
    return posts


def _scrape_ppomppu() -> list[dict]:
    posts = []
    soup = _get_soup("https://www.ppomppu.co.kr/hot.php", encoding="euc-kr")
    if not soup: return posts
    for item in soup.select("table.board_table tr"):
        tds = item.select("td")
        if len(tds) < 7: continue
        title_td = tds[2]
        a = None
        for link in reversed(title_td.select("a")):
            if link.get_text(strip=True):
                a = link
                break
        if not a: continue
        title = a.get_text(strip=True)
        if not title or len(title) < 2: continue
        comment_count = 0
        cm = re.search(r"(\d+)\s*$", title_td.get_text(strip=True))
        if cm:
            comment_count = int(cm.group(1))
            title = re.sub(r"\s*\d+\s*$", "", title)
        href = a.get("href", "")
        if href and not href.startswith("http"): href = "https://www.ppomppu.co.kr" + href
        view_count = _parse_number(tds[6].get_text())
        timestamp = _parse_date(tds[4].get_text(strip=True))
        if len(posts) >= 30: break
        posts.append({"rank": len(posts)+1, "title": title, "url": href, "source": "뽐뿌", "source_id": "ppomppu", "category": "쇼핑/생활", "view_count": view_count, "comment_count": comment_count, "timestamp": timestamp})
    return posts


def _scrape_mlbpark() -> list[dict]:
    posts = []
    soup = _get_soup("https://mlbpark.donga.com/mp/b.php?b=bullpen")
    if not soup: return posts
    for item in soup.select("table.tbl_type01 tbody tr"):
        tds = item.select("td")
        if len(tds) < 5: continue
        if tds[0].get_text(strip=True) == "공지": continue
        a = item.select_one("a.txt")
        if not a: continue
        title = a.get_text(strip=True)
        if not title or len(title) < 2: continue
        href = a.get("href", "")
        if href and not href.startswith("http"): href = "https://mlbpark.donga.com" + href
        view_count = _parse_number(tds[4].get_text())
        comment_count = 0
        r = item.select_one("a.replycnt")
        if r: comment_count = _parse_number(r.get_text())
        timestamp = _parse_date(tds[3].get_text(strip=True))
        if len(posts) >= 30: break
        posts.append({"rank": len(posts)+1, "title": title, "url": href, "source": "엠팍", "source_id": "mlbpark", "category": "스포츠", "view_count": view_count, "comment_count": comment_count, "timestamp": timestamp})
    return posts


def _scrape_clien() -> list[dict]:
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
        view_count = comment_count = 0
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
        posts.append({"rank": rank, "title": title, "url": href, "source": "클리앙", "source_id": "clien", "category": "테크", "view_count": view_count, "comment_count": comment_count, "timestamp": timestamp})
    return posts


def _scrape_nate_pann() -> list[dict]:
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
        view_count = comment_count = 0
        count_el = item.select_one("span.count, span.cnt")
        if count_el:
            view_count = _parse_number(count_el.get_text())
        reply_el = item.select_one("span.reply, em.reply")
        if reply_el:
            comment_count = _parse_number(reply_el.get_text())
        timestamp = None
        date_el = item.select_one("span.date, span.time")
        if date_el: timestamp = _parse_date(date_el.get_text(strip=True))
        posts.append({"rank": rank, "title": title, "url": href, "source": "네이트 판", "source_id": "nate_pann", "category": "이슈", "view_count": view_count, "comment_count": comment_count, "timestamp": timestamp})
    return posts


def _scrape_bobaedream() -> list[dict]:
    posts = []
    soup = _get_soup("https://www.bobaedream.co.kr/list?code=best")
    if not soup: return posts
    for rank, item in enumerate(soup.select("tbody tr")[:30], 1):
        a = item.select_one("td.pl14 a")
        if not a: continue
        title = a.get_text(strip=True)
        if not title or len(title) < 2: continue
        href = a.get("href", "")
        if href and not href.startswith("http"): href = "https://www.bobaedream.co.kr" + href
        view_count = comment_count = 0
        v = item.select_one("td.count")
        if v: view_count = _parse_number(v.get_text())
        td_pl14 = item.select_one("td.pl14")
        if td_pl14:
            cm = re.search(r"\((\d+)\)", td_pl14.get_text())
            if cm: comment_count = int(cm.group(1))
        timestamp = None
        d = item.select_one("td.date")
        if d: timestamp = _parse_date(d.get_text(strip=True))
        posts.append({"rank": rank, "title": title, "url": href, "source": "보배드림", "source_id": "bobaedream", "category": "자동차", "view_count": view_count, "comment_count": comment_count, "timestamp": timestamp})
    return posts

def _scrape_etoland() -> list[dict]:
    posts = []
    soup = _get_soup("https://www.etoland.co.kr/bbs/hit.php", encoding="euc-kr")
    if not soup: return posts
    target = None
    for art in soup.select("article"):
        if not art.get("class", []):
            target = art
            break
    if not target: return posts
    for item in target.select("li")[:30]:
        a = item.select_one("a")
        if not a: continue
        text = a.get_text(strip=True)
        if not text or len(text) < 3: continue
        text = re.sub(r"^\d+", "", text)
        comment_count = 0
        cm = re.search(r"\((\d+)\)\s*$", text)
        if cm:
            comment_count = int(cm.group(1))
            text = re.sub(r"\s*\(\d+\)\s*$", "", text)
        title = text.strip()
        if not title or len(title) < 2: continue
        href = a.get("href", "")
        if href and not href.startswith("http"): href = "https://www.etoland.co.kr/" + href.lstrip("./").lstrip("/")
        posts.append({"rank": len(posts)+1, "title": title, "url": href, "source": "이토랜드", "source_id": "etoland", "category": "유머", "view_count": 0, "comment_count": comment_count, "timestamp": None})
    return posts

def _scrape_humoruniv() -> list[dict]:
    posts = []
    try:
        resp = requests.get("https://web.humoruniv.com/board/humor/list.html?table=pds&st=day", headers=HEADERS, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        resp.encoding = "euc-kr"
        soup = BeautifulSoup(resp.text, "lxml")
    except Exception:
        return posts
    for rank, item in enumerate(soup.select("table#post_list tr[id^='li_chk_pds-']")[:30], 1):
        title_el = item.select_one("td.li_sbj a.li span[id^='title_chk_pds-']")
        if not title_el: continue
        title = title_el.get_text(strip=True)
        if not title or len(title) < 2: continue
        a = item.select_one("td.li_sbj a.li")
        href = a.get("href", "") if a else ""
        if href and not href.startswith("http"): href = "https://web.humoruniv.com/board/humor/" + href.lstrip("./")
        view_count = comment_count = 0
        tds = item.select("td.li_und")
        if tds: view_count = _parse_number(tds[0].get_text())
        cmt_el = item.select_one("span.list_comment_num")
        if cmt_el: comment_count = _parse_number(cmt_el.get_text())
        timestamp = None
        d = item.select_one("td.li_date span.w_date")
        t = item.select_one("td.li_date span.w_time")
        if d and t: timestamp = _parse_date(d.get_text(strip=True) + " " + t.get_text(strip=True))
        elif d: timestamp = _parse_date(d.get_text(strip=True))
        posts.append({"rank": rank, "title": title, "url": href, "source": "웃긴대학", "source_id": "humoruniv", "category": "유머", "view_count": view_count, "comment_count": comment_count, "timestamp": timestamp})
    return posts

def _scrape_82cook() -> list[dict]:
    posts = []
    soup = _get_soup("https://www.82cook.com/entiz/enti.php?bn=15")
    if not soup: return posts
    count = 0
    for item in soup.select("tbody tr"):
        a = item.select_one("td.title a:not(.bbs_title_word)")
        if not a: continue
        title = a.get_text(strip=True)
        if not title or len(title) < 2: continue
        href = a.get("href", "")
        if href and not href.startswith("http"): href = "https://www.82cook.com/entiz/" + href.lstrip("./")
        view_count = comment_count = 0
        v = item.select_one("td.numbers:last-child")
        if v: view_count = _parse_number(v.get_text())
        c = item.select_one("td.title em")
        if c: comment_count = _parse_number(c.get_text())
        count += 1
        if count > 30: break
        timestamp = None
        d = item.select_one("td.regdate")
        if d:
            raw = d.get("title") or d.get_text(strip=True)
            timestamp = _parse_date(raw)
        posts.append({"rank": count, "title": title, "url": href, "source": "82쿡", "source_id": "82cook", "category": "쇼핑/생활", "view_count": view_count, "comment_count": comment_count, "timestamp": timestamp})
    return posts

def _scrape_slrclub() -> list[dict]:
    posts = []
    soup = _get_soup("https://www.slrclub.com/bbs/zboard.php?id=best_article")
    if not soup: return posts
    for rank, item in enumerate(soup.select("tbody tr")[:30], 1):
        sbj_td = item.select_one("td.sbj")
        if not sbj_td: continue
        a = sbj_td.select_one("a")
        if not a: continue
        full_text = sbj_td.get_text(strip=True)
        cm = re.search(r"\[(\d+)\]$", full_text)
        comment_count = int(cm.group(1)) if cm else 0
        title = a.get_text(strip=True)
        if not title or len(title) < 2: continue
        href = a.get("href", "")
        if href and not href.startswith("http"): href = "https://www.slrclub.com" + href
        view_count = 0
        v = item.select_one("td.list_click")
        if v: view_count = _parse_number(v.get_text())
        timestamp = None
        d = item.select_one("td.list_date")
        if d: timestamp = _parse_date(d.get_text(strip=True))
        posts.append({"rank": rank, "title": title, "url": href, "source": "SLR클럽", "source_id": "slrclub", "category": "테크", "view_count": view_count, "comment_count": comment_count, "timestamp": timestamp})
    return posts

def _scrape_gasengi() -> list[dict]:
    posts = []
    soup = _get_soup("https://www.gasengi.com/main/board.php?bo_table=commu08")
    if not soup: return posts
    for rank, item in enumerate(soup.select("tbody tr:not(.table-primary)")[:30], 1):
        a = item.select_one("a.link-body-emphasis")
        if not a: continue
        title = a.get_text(strip=True)
        if not title or len(title) < 2: continue
        href = a.get("href", "")
        if href and not href.startswith("http"): href = "https://www.gasengi.com" + href
        view_count = comment_count = 0
        tds = item.select("td")
        if len(tds) >= 4: view_count = _parse_number(tds[3].get_text())
        badge = item.select_one("span.badge")
        if badge: comment_count = _parse_number(badge.get_text())
        timestamp = None
        if len(tds) >= 5: timestamp = _parse_date(tds[4].get_text(strip=True))
        posts.append({"rank": rank, "title": title, "url": href, "source": "가생이", "source_id": "gasengi", "category": "이슈", "view_count": view_count, "comment_count": comment_count, "timestamp": timestamp})
    return posts

def _scrape_todayhumor() -> list[dict]:
    posts = []
    try:
        resp = requests.get("https://www.todayhumor.co.kr/board/list.php?table=bestofbest", headers=HEADERS, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        resp.encoding = "utf-8"
        soup = BeautifulSoup(resp.text, "lxml")
    except Exception:
        return posts
    for rank, item in enumerate(soup.select("table.table_list tr.view")[:30], 1):
        a = item.select_one("td.subject > a[href*='/board/view.php']")
        if not a: continue
        title = a.get_text(strip=True)
        if not title or len(title) < 2: continue
        href = a.get("href", "")
        if href and not href.startswith("http"): href = "https://www.todayhumor.co.kr" + href
        view_count = comment_count = 0
        v = item.select_one("td.hits")
        if v: view_count = _parse_number(v.get_text())
        c = item.select_one("span.list_memo_count_span")
        if c: comment_count = _parse_number(c.get_text())
        timestamp = None
        d = item.select_one("td.date")
        if d: timestamp = _parse_date(d.get_text(strip=True))
        posts.append({"rank": rank, "title": title, "url": href, "source": "오늘의유머", "source_id": "todayhumor", "category": "유머", "view_count": view_count, "comment_count": comment_count, "timestamp": timestamp})
    return posts


# ---------------------------------------------------------------------------
# Aggregator
# ---------------------------------------------------------------------------

_ALL_SCRAPERS = [
    _scrape_dcinside, _scrape_fmkorea, _scrape_ruliweb, _scrape_theqoo,
    _scrape_arca_live, _scrape_inven, _scrape_ppomppu, _scrape_mlbpark,
    _scrape_clien, _scrape_nate_pann,
    # Phase 2 (일베/인스티즈/오르비/다모앙/해연갤은 SPA/JS렌더링/차단으로 제외)
    _scrape_bobaedream, _scrape_etoland, _scrape_humoruniv,
    _scrape_82cook, _scrape_slrclub, _scrape_gasengi, _scrape_todayhumor,
]

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
    return bool(_NOISE_PATTERNS.search(title))


def _fetch_hot_posts(force: bool = False) -> dict:
    global _cache, _cache_time
    if not force and _cache and (time.time() - _cache_time) < CACHE_TTL:
        return {**_cache, "cached": True}

    all_posts: list[dict] = []
    with ThreadPoolExecutor(max_workers=22) as executor:
        futures = {executor.submit(fn): fn.__name__ for fn in _ALL_SCRAPERS}
        for future in as_completed(futures):
            try:
                all_posts.extend(future.result(timeout=15))
            except Exception:
                pass

    # 공지/광고 제거 + 오래된 게시글 제거 (2일 이내만)
    all_posts = [p for p in all_posts if not _is_noise(p["title"]) and not _is_too_old(p.get("timestamp"))]

    # 조회수 + 댓글수 기반 통합 랭킹 정렬 (댓글 가중치 ×10)
    all_posts.sort(key=lambda p: p["view_count"] + p["comment_count"] * 10, reverse=True)

    # 순위 재부여
    for i, p in enumerate(all_posts, 1):
        p["rank"] = i

    now = datetime.now(timezone.utc).isoformat()
    result = {"posts": all_posts, "cached": False, "updated_at": now}
    _cache = result
    _cache_time = time.time()
    return result


# ---------------------------------------------------------------------------
# Vercel handler
# ---------------------------------------------------------------------------

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        force = params.get("force", ["false"])[0].lower() == "true"

        try:
            result = _fetch_hot_posts(force=force)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps(result, ensure_ascii=False).encode())
        except Exception as e:
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({
                "success": False,
                "error": f"스크래핑 중 오류 발생: {str(e)}"
            }, ensure_ascii=False).encode())

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
