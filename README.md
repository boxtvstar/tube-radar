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

- **플랫폼:** Vercel
- **프로덕션 브랜치:** `feature/admin-dashboard-enhancements` (Vercel에서 설정됨)
- **개발 브랜치:** `main`

### 배포 흐름

1. `main` 브랜치에서 작업 및 커밋
2. `main`에 push
3. 프로덕션 배포를 위해 feature 브랜치도 동기화:
   ```bash
   git push origin main:feature/admin-dashboard-enhancements
   ```
4. Vercel이 `feature/admin-dashboard-enhancements` 브랜치 변경을 감지하여 자동 배포

> **참고:** Vercel 프로덕션 브랜치를 `main`으로 변경하면 3번 과정을 생략할 수 있음 (Vercel Dashboard → Settings → Git → Production Branch)
