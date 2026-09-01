<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1upggWguSrMyEZLMit2WWA73UdjmSZica

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## 배포 (Deployment)

⚠️ **Vercel 프로젝트가 2개다. 실서비스는 `tube-radar` 프로젝트(tuberadar.kr)다. 배포 전 반드시 이 문서를 확인하고, 실서비스 배포는 임의로 하지 말 것.**

| Vercel 프로젝트 | 도메인 | 프로덕션 브랜치 | 용도 |
|---|---|---|---|
| `tube-radar` | **https://www.tuberadar.kr** | `feature/admin-dashboard-enhancements` | **실서비스** |
| `tuberadar` | https://tuberadar.vercel.app | `main` | 테스트/프리뷰 |

### 배포 흐름

1. `main` 브랜치에서 작업 및 커밋
2. `main`에 push → 테스트 프로젝트(tuberadar.vercel.app)에 자동 배포
3. 테스트 확인 후, 실서비스 배포:
   ```bash
   git push origin main:feature/admin-dashboard-enhancements
   ```
4. Vercel이 feature 브랜치 변경을 감지하여 **tuberadar.kr**에 자동 배포

### 주의사항

- 환경변수는 **두 프로젝트에 각각** 등록해야 함 (실서비스 기준은 `tube-radar` 프로젝트)
- 로컬 `.vercel/project.json`은 테스트 프로젝트(`tuberadar`)에 연결되어 있음 — `vercel` CLI 명령은 테스트 프로젝트를 대상으로 동작함

### 롤백

- Vercel Dashboard → `tube-radar` 프로젝트 → Deployments → **Instant Rollback**
- git 백업 지점: `backup/deployed-2026-07-20` 브랜치 / `deployed-2026-07-20` 태그
