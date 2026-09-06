# 커뮤니티 핫게시글 기능 이관 문서

> TubeRadar에 구현된 "커뮤니티 핫게시글" 기능을 다른 프로젝트에 동일하게 구현하기 위한 전달 문서.
> 기준은 실제 코드이며, 아래 파일 4개가 기능의 전부다.

## 1. 기능 요약

12개 한국 커뮤니티의 실시간 인기 글을 한 화면에 모아 보여주는 기능.
- 서버가 각 커뮤니티 목록 페이지를 스크래핑해 글 목록(제목·링크·조회수·댓글수·시각)을 만든다
- 프론트는 목록을 카드로 보여주고, 각 글에 **썸네일**과 **호버 미리보기(본문 요약)** 를 붙인다
- 썸네일/미리보기는 글이 화면에 보일 때 개별 요청으로 가져온다 (lazy)
- 목록은 1시간 캐시로 자동 갱신된다

## 2. 파일 구성 (이 4개가 전부)

| 파일 | 역할 | 줄수 |
|---|---|---|
| `src/components/CommunityHotPosts.tsx` | 프론트 UI (목록·썸네일·미리보기·캐시) | 500 |
| `api/community.py` | 핫게시글 수집 서버리스 함수 (12개 커뮤니티 스크래퍼) | 697 |
| `api/preview.py` | 글 미리보기 추출 (og 메타 + 본문 폴백) | 243 |
| `api/image_proxy.py` | 핫링크 차단 우회용 이미지 프록시 | 98 |

의존: Python `requests`, `beautifulsoup4`, `lxml` (`requirements.txt`). 프론트는 React + TypeScript + Tailwind.

## 3. API 엔드포인트

Vercel 서버리스 함수(Python). `vercel.json` rewrite로 경로를 맞춘다.

| 경로 | 실제 함수 | 설명 |
|---|---|---|
| `GET /api/community/hot-posts` | `api/community.py` | 12개 커뮤니티 핫게시글 목록. 서버 1시간 캐시 |
| `GET /api/community/preview?url=<글주소>` | `api/preview.py` | 미리보기 `{description, image}` |
| `GET /api/image-proxy?url=<이미지주소>` | `api/image_proxy.py` | 이미지 바이트 그대로 전달 (referer 위장) |

`vercel.json`에 넣을 것:
```json
"functions": {
  "api/community.py": { "maxDuration": 30 },
  "api/image_proxy.py": { "maxDuration": 10 }
},
"rewrites": [
  { "source": "/api/community/hot-posts", "destination": "/api/community" },
  { "source": "/api/community/preview", "destination": "/api/preview" },
  { "source": "/api/image-proxy", "destination": "/api/image_proxy" }
]
```

## 4. 데이터 형태

### hot-posts 응답
```ts
{
  posts: Array<{
    rank: string;
    title: string;
    url: string;
    source: string;        // "디시인사이드" 등 표시명
    source_id: string;     // "dcinside" 등
    category: string;      // "유머" | "테크" | ...
    view_count: string;
    comment_count: string;
    timestamp: string;     // ISO
    thumbnail: string;     // 대부분 빈 문자열 (프론트가 preview로 채움)
  }>;
  cached: boolean;
  updated_at: string;      // ISO — 갱신 시각
}
```

### preview 응답
```ts
{ description: string; image: string }   // 없으면 빈 문자열
```

## 5. 수집 대상 12개 커뮤니티

디시인사이드, 에펨코리아, 루리웹, 더쿠, 아카라이브, 인벤, 뽐뿌, 엠팍, 클리앙, 네이트 판, 보배드림, 82쿡, 가생이, 웃긴대학 등 (`api/community.py`의 `_scrape_*` 함수 17개). 각 함수는 목록 페이지 HTML을 파싱해 위 형태로 반환한다.

## 6. 반드시 옮겨야 하는 핵심 노하우 (이게 빠지면 썸네일이 안 뜬다)

이 기능에서 가장 어려웠던 부분이 **커뮤니티들의 봇/핫링크 차단 우회**다. 아래를 그대로 구현할 것.

### 6-1. 미리보기(`preview.py`) 요청 헤더
서버(데이터센터 IP)가 요청하면 여러 커뮤니티가 빈 페이지·403을 준다. **완전한 크롬 헤더 세트 + 해당 사이트 자기 referer**를 보내야 정상 페이지를 준다.
```python
HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ... Chrome/131.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,...",
  "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8",
  "Sec-Ch-Ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
  "Sec-Ch-Ua-Mobile": "?0", "Sec-Ch-Ua-Platform": '"Windows"',
  "Sec-Fetch-Dest": "document", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Site": "none",
  "Upgrade-Insecure-Requests": "1",
}
# 요청 시 Referer = 글 URL의 origin (https://www.clien.net/ 처럼)
```
- **클리앙**은 이 헤더 세트가 없으면 og:image가 빠진 빈 껍데기 페이지를 준다.
- **웃긴대학·뽐뿌**는 referer 없으면 차단한다.

### 6-2. 차단 페이지 파싱 금지
응답이 200이 아니면(403 등) 파싱하지 말고 빈 결과를 반환할 것. 안 그러면 "403 Forbidden"이 미리보기 설명으로 노출된다.

### 6-3. 사이트 기본(placeholder) 이미지 필터
og:image가 사이트 로고인 경우가 있다 (네이트판 `img.pann.com/images/og-talk.png`). 이런 것은 무시하고 본문 이미지로 폴백. **주의: og:image뿐 아니라 twitter:image 폴백에도 같은 필터를 적용**해야 한다 (한쪽만 하면 로고가 다시 들어온다).

### 6-4. 클리앙 이미지 CDN 특수 규칙
`edgio.clien.net` 이미지는 referer가 아니라 **`?scale=width:740` 쿼리 파라미터**가 있어야만 이미지를 준다. 없으면 에러 페이지로 302. 미리보기에서 클리앙 이미지 URL을 반환할 때 이 파라미터를 붙일 것.

### 6-5. 이미지 프록시(`image_proxy.py`)
브라우저가 직접 이미지를 로드하면 핫링크 차단되는 호스트가 있다. 프론트의 `PROXY_DOMAINS`에 해당하는 호스트는 `/api/image-proxy`를 경유하고, 프록시는 **이미지 호스트별 올바른 Referer**를 붙여 대신 가져온다.
```python
_REFERER_MAP = {
  "humoruniv.com": "https://web.humoruniv.com/",
  "ppomppu.co.kr": "https://www.ppomppu.co.kr/",
  "ruliweb.com": "https://bbs.ruliweb.com/",
  "inven.co.kr": "https://www.inven.co.kr/",
  "fmkorea.com": "https://www.fmkorea.com/",
  "theqoo.net": "https://theqoo.net/",
}
```
프론트 `PROXY_DOMAINS`와 프록시 `ALLOWED_DOMAINS`(허용 목록)를 **같이** 관리할 것. 웃긴대학(`humoruniv.com`)은 반드시 포함.

### 6-6. 본문 이미지 셀렉터
og:image가 없을 때 본문에서 이미지를 찾는 사이트별 CSS 셀렉터 목록(`_BODY_SELECTORS`)이 `preview.py`에 있다. 사이트 추가 시 여기에 셀렉터를 넣는다.

## 7. 프론트 동작 규칙 (`CommunityHotPosts.tsx`)

- 목록: `localStorage` 1시간 캐시 → 만료 시 재요청, 탭 열어둔 상태면 1시간마다 자동 재요청
- 썸네일: `IntersectionObserver`로 카드가 화면에 보일 때만 `/api/community/preview` 호출 (N+1 방지용 lazy). 결과는 모듈 캐시(`thumbnailCache`)에 저장
- 미리보기 팝업: 호버 시 지연 후 `/api/community/preview` 호출, 결과 캐시
- 이미지 검증(`isValidImage`): gif/svg/영상, 아이콘·로고 URL은 썸네일로 쓰지 않음
- 실패 시 소스별 색상의 대체 아이콘 표시

## 8. 앱 통합 (App.tsx에서 하는 것)

- 사이드바 메뉴 "커뮤니티 핫게시글" → `isCommunityMode` 토글 → `<CommunityHotPosts />` 렌더
- 골드 등급 전용 잠금 처리
- (선택) 메뉴 옆 **N 배지**: `hot-posts`의 `updated_at`이 `localStorage('community_hot_seen')`보다 크면 표시, 메뉴 열면 갱신 시각을 저장하고 제거

## 9. 알려진 한계

- 서버 캐시는 인스턴스 메모리라 콜드 스타트 시 초기화됨 (문제는 없음, 다시 수집함)
- 커뮤니티 측 HTML 구조가 바뀌면 해당 `_scrape_*` 함수만 고치면 됨
