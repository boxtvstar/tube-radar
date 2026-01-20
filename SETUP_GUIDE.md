# 튜브 레이더 2.1 (Tube Radar 2.1) - 백엔드 및 배포 설정 가이드

성공적으로 프론트엔드 분석을 마치고, 파이어베이스(Firebase) 기반의 백엔드 로직을 모두 구현했습니다.
이제 서비스가 실제로 작동하려면 **Firebase 설정**과 **Vercel 배포**가 필요합니다. 아래 가이드를 따라 진행해 주세요.

## 1. Firebase 프로젝트 설정

1. **[Firebase 콘솔](https://console.firebase.google.com/)**에 접속하여 새 프로젝트를 만드세요 (예: `tube-radar-v2`).
2. **Google 애널리틱스**는 사용 안 함으로 설정해도 됩니다.
3. 프로젝트가 생성되면 대시보드로 이동합니다.

### A. Authentication (로그인) 설정

1. 좌측 메뉴 **빌드 > Authentication** 클릭.
2. **시작하기** 버튼 클릭.
3. **Sign-in method** 탭에서 **Google** 선택.
4. **사용 설정** 스위치를 켜고, 지원 이메일을 선택한 뒤 **저장**.

### B. Firestore Database (데이터베이스) 설정

1. 좌측 메뉴 **빌드 > Firestore Database** 클릭.
2. **데이터베이스 만들기** 클릭.
3. 위치는 `asia-northeast3` (서울) 또는 `us-central1` 선택 (가까운 곳 추천).
4. **보안 규칙**은 **프로덕션 모드**로 시작 선택 후 **사용 설정** 클릭.
5. 데이터베이스가 생성되면 **규칙(Rules)** 탭으로 이동하여 아래 코드로 교체하고 **게시**를 누르세요.

```bash
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    # 사용자는 자신의 데이터(users/{userId})만 읽고 쓸 수 있음
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

### C. 웹 앱 등록 및 키 확인

1. 프로젝트 개요(집 모양 아이콘) 옆의 **설정(톱니바퀴) > 프로젝트 설정**으로 이동.
2. 하단 **내 앱** 섹션에서 **웹 아이콘(</>)** 클릭.
3. 앱 닉네임 입력 (예: `Tube Radar Web`) 후 **앱 등록**.
4. 포스팅 호스팅 설정은 건너뛰어도 됩니다.
5. **SDK 설정 및 구성**에 표시되는 `const firebaseConfig = { ... }` 내용을 확인하세요. 이 값들이 환경 변수로 필요합니다.

---

## 2. 환경 변수 설정 (.env.local)

프로젝트 폴더의 `.env.local` 파일을 열고, 아래 내용을 채워주세요. (기존 내용 아래에 추가)
_주의: `GEMINI_API_KEY`는 기존에 사용하던 키를 유지하세요._

```env
GEMINI_API_KEY=사용중인_Gemini_API_키

# Firebase 설정 (위 단계에서 확인한 값으로 채워넣기)
VITE_FIREBASE_API_KEY=abcd1234...
VITE_FIREBASE_AUTH_DOMAIN=tube-radar-v2.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=tube-radar-v2
VITE_FIREBASE_STORAGE_BUCKET=tube-radar-v2.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
VITE_FIREBASE_APP_ID=1:123456789:web:abcdef
```

저장 후, 터미널에서 서버를 재시작(`Ctrl+C` 후 `npm run dev`)하면 로컬에서 **구글 로그인**이 작동하는지 확인할 수 있습니다.

---

## 3. Vercel 배포

이 프로젝트는 Vite 기반이므로 Vercel에 매우 쉽게 배포됩니다.

1. [Vercel](https://vercel.com)에 로그인 후 **Add New > Project**.
2. GitHub 저장소를 연결하거나, 로컬에서 Vercel CLI를 사용합니다.
3. **Environment Variables** (환경 변수) 섹션에 `.env.local`에 작성한 모든 키와 값(7개)을 똑같이 추가합니다.
   - `GEMINI_API_KEY`
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_...` (나머지 5개)
4. **Deploy** 버튼을 누르면 끝입니다!

---

### 완료되었습니다!

이제 사용자는 본인의 구글 계정으로 로그인하여 **자신만의 유튜브 채널 모니터링 리스트**를 관리할 수 있습니다. 모든 데이터는 Firestore에 안전하게 저장되므로, 기기를 옮겨도 데이터가 유지됩니다.
