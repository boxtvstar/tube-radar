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

- **플랫폼:** Vercel (프로젝트: `tuberadar`, 도메인: `tuberadar.vercel.app`)
- **프로덕션 브랜치:** `main` (Vercel 설정 기준)

### 배포 흐름

1. `main` 브랜치에서 작업 및 커밋
2. `main`에 push
3. Vercel이 자동으로 프로덕션 배포

> **주의:** `main` 이외 브랜치에 push하면 preview 배포만 생성되고 실서비스에는 반영되지 않음.
> 과거 사용하던 `feature/admin-dashboard-enhancements` 브랜치는 더 이상 배포와 무관함.

### 롤백

- Vercel Dashboard → Deployments → 이전 배포 선택 → **Instant Rollback**
- 백업 지점: `backup/deployed-2026-07-20` 브랜치 / `deployed-2026-07-20` 태그
