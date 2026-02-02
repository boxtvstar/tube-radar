# Apify 토큰 온라인 배포(운영) 환경 설정 가이드

로컬 환경(`localhost`)에서는 `.env.local` 파일에 토큰을 저장하여 사용했지만, 이 파일은 보안상 Git에 업로드되지 않습니다. 따라서 온라인 서버(Vercel, Netlify, AWS 등)에 배포할 때는 해당 플랫폼의 **환경 변수(Environment Variables)** 설정 메뉴에 직접 등록해주어야 합니다.

## 1. 주요 배포 플랫폼별 설정 방법

### A. Vercel (가장 추천)

Vite 프로젝트를 가장 쉽게 배포할 수 있는 플랫폼입니다.

1. Vercel 대시보드에서 해당 프로젝트로 이동합니다.
2. 상단 탭에서 **Settings**를 클릭합니다.
3. 좌측 메뉴에서 **Environment Variables**를 선택합니다.
4. 아래 내용을 입력하고 **Add**를 클릭합니다.
   - **Key**: `VITE_APIFY_TOKEN`
   - **Value**: `YOUR_APIFY_TOKEN_HERE`
5. 설정을 저장한 후, **Deployments** 탭으로 가서 **Redeploy**를 눌러야 반영됩니다. (새로 빌드될 때 환경 변수가 주입됩니다.)

### B. Netlify

1. Netlify 대시보드에서 해당 사이트의 **Site configuration**으로 이동합니다.
2. 좌측 메뉴에서 **Environment variables**를 선택합니다.
3. **Add a variable** 버튼을 클릭합니다.
4. 아래 내용을 입력하고 저장합니다.
   - **Key**: `VITE_APIFY_TOKEN`
   - **Value**: `YOUR_APIFY_TOKEN_HERE`
5. 새로운 배포(Trigger deploy)를 실행하여 변경 사항을 적용합니다.

### C. GitHub Pages (Actions 사용 시)

GitHub Pages는 정적 호스팅이므로, 빌드 시점에 토큰이 코드에 포함되어야 합니다. GitHub Actions Secrets를 사용합니다.

1. GitHub 레포지토리의 **Settings** > **Secrets and variables** > **Actions**로 이동합니다.
2. **New repository secret**을 클릭합니다.
3. **Name**: `VITE_APIFY_TOKEN`
4. **Secret**: `YOUR_APIFY_TOKEN_HERE`
5. `.github/workflows/deploy.yml` (배포 워크플로우 파일)의 빌드 단계(`npm run build`)에 환경 변수를 연결합니다.
   ```yaml
   - name: Build
     run: npm run build
     env:
       VITE_APIFY_TOKEN: ${{ secrets.VITE_APIFY_TOKEN }}
   ```

## 2. 보안 주의사항 (중요)

`VITE_`로 시작하는 환경 변수는 빌드 시점에 **자바스크립트 코드 내부에 텍스트로 포함되어 공개(Public)**됩니다.
즉, 브라우저 개발자 도구를 통해 누구나 이 토큰을 볼 수 있게 됩니다.

### 해결 방법 (권장)

Apify 토큰과 같이 과금과 연결된 민감한 키는 프론트엔드에 직접 노출하는 것보다 **백엔드(Server)를 거쳐 호출하는 것**이 가장 안전합니다.

현재 프로젝트 구조상 백엔드(`server/transcript.py` 등)가 있다면, 프론트엔드가 아닌 백엔드에서 Apify를 호출하도록 수정하는 것이 좋습니다. 하지만 현재는 빠른 구현을 위해 프론트엔드에서 직접 호출하고 있으므로, **Apify 대시보드에서 사용량 한도(Limit)를 설정**해두는 것을 강력히 권장합니다.

1. **Usage Limit 설정**: Apify Console > Settings > Usage 에서 일일/월간 지출 한도를 설정하세요.
2. **Referer 제한**: 가능하다면 해당 토큰이 특정 도메인(예: `your-site.com`)에서만 작동하도록 제한할 수 있는지 API 설정을 확인하세요.
