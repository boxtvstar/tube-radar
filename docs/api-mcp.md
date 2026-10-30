# TubeRadar 공개 API · MCP 서버

회원이 자기 Claude / Codex / Cursor 에 튜브레이더 도구를 붙여 쓰게 하는 기능. 회원은 본인 구독으로 AI를 돌리고, 튜브레이더는 도구만 제공하므로 양쪽 모두 추가 AI 비용이 없다.

## 구성

| 파일 | 역할 |
|---|---|
| `api/mcp.py` | MCP 서버(JSON-RPC, Streamable HTTP) + REST `/api/v1/*` + 쇼츠 탐색 서버판(3시간 캐시) + 키 검증·일일 한도 |
| (`api/mcp.py` 안) `/api/keys` | 키 발급/목록/폐기. Firebase ID 토큰으로 로그인 검증, 골드 이상만 발급. 별도 파일이 아니라 mcp.py에 합쳐져 있음 (아래 함수 수 제한 참고) |
| `src/components/ApiIntegrationPanel.tsx` | 마이페이지 "API 연동" 탭 UI (발급·목록·폐기 + 클라이언트별 연결 안내) |

모든 서버 함수는 자립형이다 (Vercel이 함수를 격리하므로 옆 파일 import 금지 — `daily_rising` 사고 참고).

⚠️ **Vercel Hobby 플랜은 배포당 서버리스 함수 12개가 상한이다** (`exceeded_serverless_functions_per_deployment`). 현재 `api/*.py`가 정확히 12개라 **새 함수를 추가하려면 기존 것을 합치거나 지워야 한다**. 이 때문에 키 관리도 mcp.py에 합쳤고, 미사용이던 transcript.py를 삭제했다.

## 엔드포인트

| 경로 | 설명 |
|---|---|
| `POST /api/mcp` | MCP. `Authorization: Bearer <키>` |
| `POST /api/mcp/<키>` | 키를 경로로 (claude.ai 커스텀 커넥터·Codex·Cursor처럼 헤더를 못 붙이는 경우) |
| `GET /api/v1/shorts?region=KR&deep=false&limit=20` | 오늘 뜨는 쇼츠 채널 |
| `GET /api/v1/hot-posts?source=클리앙&limit=30` | 커뮤니티 핫게시글 |
| `GET /api/v1/rising-channels?limit=20` | 신규 급성장 채널 |
| `POST/GET/DELETE /api/keys` | 키 관리 (프론트 전용, idToken 필요) |

MCP 메서드: `initialize`, `ping`, `tools/list`, `tools/call`. 알림(id 없는 메시지)은 202. GET `/api/mcp`는 405(SSE 미지원, 스펙 허용). 배치 요청 미지원.

## 인증·한도

- 키 형식 `tr_` + 48 hex. Firestore `api_keys/{sha256(key)}` 에 해시만 저장 (평문 미저장).
- 문서 필드: `uid, email, name, prefix, createdAt, lastUsedAt, revoked, usage{YYYY-MM-DD: n}`
- 키당 **하루 도구 호출 100회**(`API_DAILY_LIMIT_PER_KEY`), 서비스 전체 **하루 5,000회**(`API_DAILY_LIMIT_GLOBAL`, `system_data/api_usage`에 합산) — 둘 다 Vercel 환경변수로 재배포 없이 조정. 회원당 **활성 키 5개**. 폐기 즉시 401.
- 한도에 세는 것은 **tools/call 과 REST 도구 호출만**. initialize/tools/list/ping/notifications 같은 핸드셰이크는 인증만 하고 카운트하지 않는다 (초과 시에도 핸드셰이크는 되고 도구 호출에서 429/503).
- 발급 조건: 관리자(`role == admin` 또는 `email == ADMIN_EMAIL`) 또는 골드/플래티넘(프론트 `deriveStatusFromLegacy`와 동일 규칙 — `status` 없으면 `plan`/`role` 폴백) 이고 `expiresAt` 미경과.
- **매 API 호출마다 회원 등급을 재확인**한다. 골드가 끝나면 이미 발급된 키도 즉시 `403 membership_inactive`.
- 모든 MCP 메시지(initialize 포함)에 인증 적용 — 키 없이는 도구 목록도 안 보인다.

## 쇼츠 탐색 할당량

운영자 `YOUTUBE_API_KEY` 하나를 회원 전체가 나눠 쓴다.
- 기본(`deep=false`): 카테고리 13개 인기차트 + 채널 조회 ≈ **17 유닛/스캔**
- `deep=true`: 최근 7일 검색 1회(100유닛) 추가 ≈ 117 유닛
- 국가·deep 조합별 **3시간 캐시** — 인스턴스 메모리(L1) + Firestore `system_data/shorts_cache`(L2, 인스턴스 간 공유). Vercel은 인스턴스마다 메모리가 따로라 L2가 없으면 콜드 인스턴스마다 재스캔해 쿼터를 더 쓴다 → 하루 최대 7국가×2×8회 = 112회 스캔 상한이지만 실제론 KR 위주라 여유.

## 환경변수 (실서비스 tube-radar)

`FIREBASE_SERVICE_ACCOUNT`, `YOUTUBE_API_KEY`, `VITE_FIREBASE_API_KEY`(ID 토큰 검증용, 이미 있음). 없는 배포(테스트)에서는 503 `not_configured`.

## 회원 연결 예시

```bash
# Claude Code
claude mcp add --transport http tuberadar https://www.tuberadar.kr/api/mcp --header "Authorization: Bearer tr_…"
```
```
# claude.ai / Claude Desktop 커스텀 커넥터 URL (인증 없음)
https://www.tuberadar.kr/api/mcp/tr_…
```
```toml
# Codex ~/.codex/config.toml
[mcp_servers.tuberadar]
url = "https://www.tuberadar.kr/api/mcp/tr_…"
```

## 운영 메모

- 키 유출 의심 시 마이페이지에서 폐기 → 새 발급. 관리자는 Firestore `api_keys`에서 `revoked: true`로 직접 막을 수도 있다.
- 도구 추가는 `api/mcp.py`의 `TOOLS` 목록 + `run_tool` 분기 + (REST면) `REST_TOOL_BY_PATH` 한 줄.
