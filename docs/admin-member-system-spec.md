# 관리자 & 회원 승인 시스템 기술 명세서

> TubeRadar 프로젝트에서 검증된 관리자/회원 관리 구조를 새 프로젝트에 동일하게 적용하기 위한 명세서입니다.
> **"추천팩관리", "추천소재관리" 탭은 제외**하고 나머지 기능을 그대로 구현합니다.

---

## 1. 기술 스택

| 항목 | 사용 기술 |
|------|----------|
| 프론트엔드 | React + TypeScript + Vite |
| 인증 | Firebase Authentication (Google OAuth) |
| 데이터베이스 | Firestore |
| 스타일링 | Tailwind CSS |

---

## 2. 인증 흐름 (Authentication Flow)

### 2.1 로그인
- **Google OAuth** 팝업 방식 (`signInWithPopup`)
- 로그인 성공 시 Firestore `users/{uid}` 문서 생성/업데이트

### 2.2 세션 관리
- Firestore `onSnapshot()`으로 실시간 유저 상태 감시
- role, plan, expiresAt 변경 시 즉시 UI 반영
- 로그아웃 시 `signOut()` + `window.location.reload()`

### 2.3 라우팅 가드
```
비로그인 → 로그인 페이지
로그인 + role === 'pending' → 승인 대기 화면
로그인 + role === 'admin' → 관리자 대시보드 접근 가능
로그인 + role === 'approved' → 일반 서비스 이용
```

---

## 3. 유저 데이터 스키마

### 3.1 Firestore Collection: `users/{uid}`

```typescript
interface UserData {
  uid: string;                    // Firebase UID (문서 ID)
  email: string;
  displayName: string;
  photoURL: string;
  role: 'admin' | 'approved' | 'pending' | 'guest';
  plan: 'free' | 'silver' | 'gold' | 'admin';
  createdAt: string;              // ISO timestamp
  lastLoginAt: string;            // ISO timestamp
  expiresAt?: string;             // 멤버십 만료일 (null = 무제한)
  channelId?: string;             // 유튜브 채널 ID (화이트리스트 매칭 키)
  membershipTier?: string;        // "Gold", "Silver" 등
  adminMemo?: string;             // 관리자 메모
}
```

### 3.2 역할(Role) 체계

| Role | 설명 | 일일 포인트 |
|------|------|------------|
| `admin` | 관리자 (전체 기능 + 관리자 패널) | 10,000 |
| `approved` | 승인된 회원 | plan에 따라 1,000~5,000 |
| `pending` | 승인 대기 | 1,000 (제한적 기능) |
| `guest` | 미가입/비로그인 | 1,000 (기본 기능만) |

### 3.3 플랜(Plan)별 포인트

```typescript
let total = 1000;                  // free (기본)
if (plan === 'silver') total = 2000;
if (plan === 'gold') total = 5000;
if (plan === 'admin') total = 10000;
```

---

## 4. 회원 승인 워크플로우

### 4.1 흐름도

```
신규 유저 (Google 로그인)
    ↓
Firestore에 유저 문서 생성 (role: 'pending')
    ↓
승인 대기 화면 표시 (PendingApproval)
    ↓
유저가 YouTube 채널 ID 입력 (또는 자동 감지)
    ↓
화이트리스트와 실시간 대조
    ↓
매칭 성공 → role: 'approved', plan 설정, expiresAt 계산
매칭 실패 → 'pending' 유지, 에러 모달 표시
```

### 4.2 화이트리스트 구조

**Firestore Document: `system_data/membership_whitelist`**

```typescript
interface MembershipWhitelist {
  validChannelIds: string[];       // 승인된 채널 ID 배열
  memberDetails: [{
    id: string;                    // YouTube 채널 ID
    name: string;                  // 채널명
    tier: string;                  // "Gold", "Silver" 등
    tierDuration: string;          // 해당 티어 유지 기간
    totalDuration: string;         // 전체 멤버십 기간
    status: string;                // "재가입", "가입함"
    lastUpdate: string;            // ISO timestamp
    remainingDays?: string;        // 만료까지 남은 일수
  }];
  updatedAt: string;
  updatedBy: string;               // 업로드한 관리자 이메일
  count: number;                   // 전체 멤버 수
}
```

### 4.3 자동 승인 로직 (핵심)

```typescript
// AuthContext에서 실시간 화이트리스트 매칭
const match = memberDetails.find(m => m.id === userChannelId);

if (match) {
  let targetPlan = 'free';
  const tier = (match.tier || '').toLowerCase();
  if (tier.includes('gold')) targetPlan = 'gold';
  else if (tier.includes('silver')) targetPlan = 'silver';

  await updateDoc(userRef, {
    role: 'approved',
    plan: targetPlan,
    membershipTier: match.tier,
    expiresAt: calculateExpiry(match.lastUpdate, match.tier)
  });
}
```

---

## 5. 관리자 대시보드 (Admin Dashboard)

### 구현할 탭: 5개

| # | 탭 이름 | 기능 | 배지 |
|---|---------|------|------|
| 1 | **사용자 관리** | 회원 목록, 승인, 만료 연장, 삭제 | 대기 중 유저 수 |
| 2 | **문의 수신함** | 1:1 문의 수신/답변 | 미답변 수 |
| 3 | **멤버십 관리** | CSV 화이트리스트 업로드, 멤버 조회 | - |
| 4 | **공지사항 게시판** | 공지 작성/수정/발행 | - |
| 5 | **통계** | 방문자, 페이지뷰, 세션 통계 | - |

> ~~추천 팩 관리~~ / ~~추천 소재 관리~~ → **제외**

---

### 5.1 사용자 관리 탭

**기능 목록:**
- 전체/승인됨/대기중 필터
- 만료일순/최근 로그인순/역할순 정렬
- 검색 (이름, 이메일)
- **개별 작업**: 승인, 기간 연장(1일/1개월/1년), 삭제, 메모 작성
- **일괄 작업**: 체크박스 선택 후 일괄 승인/연장/삭제
- 유저별 포인트/쿼터 사용량 표시

**유저 카드에 표시할 정보:**
```
- 프로필 사진, 이름, 이메일
- 역할 배지 (admin: 보라, approved: 에메랄드, pending: 노랑)
- 플랜 (free/silver/gold)
- 멤버십 만료일 (D-day)
- 마지막 로그인
- 채널 ID
- 관리자 메모
```

### 5.2 문의 수신함 탭

**Firestore Collection: `inquiries/{id}`**

```typescript
interface Inquiry {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  userPhotoURL: string;
  subject: string;
  content: string;
  category: string;            // "기능 문의", "버그 신고", "기타"
  status: 'pending' | 'answered';
  createdAt: string;
  reply?: string;
  repliedAt?: string;
  repliedBy?: string;
}
```

**기능:**
- 전체/미답변/답변완료 필터
- 이름/내용 검색
- 인라인 답변 작성
- 답변 시 유저에게 알림 전송

### 5.3 멤버십 관리 탭

**기능:**
- CSV 파일 업로드 (채널ID, 이름, 티어, 기간 등)
- 업로드 시 화이트리스트 갱신
- 기존 멤버 vs 신규 멤버 비교 표시
- 제거된 멤버 자동 다운그레이드
- 멤버 목록 검색/정렬

**CSV 컬럼 예시:**
```
채널ID, 채널명, 티어(Gold/Silver), 티어유지기간, 전체기간, 상태, 최종갱신일
```

### 5.4 공지사항 게시판 탭

**Firestore Collection: `notices/{id}`**

```typescript
interface Notice {
  id: string;
  title: string;
  content: string;
  imageUrl?: string;
  isActive: boolean;           // 활성/비활성
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}
```

**기능:**
- 공지 작성 (제목, 내용, 이미지 업로드)
- 활성/비활성 토글
- 수정/삭제
- 한줄 공지 배너 (서비스 상단 표시)

### 5.5 통계 탭

**Firestore Collection: `analytics/daily/{date}`**

```typescript
interface DailyAnalytics {
  date: string;
  totalVisitors: number;
  loggedInVisitors: number;
  guestVisitors: number;
  byTier: { gold: number; silver: number; free: number };
  topPages: { page: string; views: number }[];
  avgSessionDuration: number;
  totalPageViews: number;
}
```

**표시 항목:**
- 일별/주별/월별 방문자 수
- 로그인/비로그인 비율
- 티어별 사용자 수
- 인기 페이지 TOP 10
- 평균 세션 시간
- 페이지뷰 추이 그래프

---

## 6. 포인트/쿼터 시스템

### 6.1 일일 사용량 관리

**Firestore Path: `users/{uid}/usage/daily`**

```typescript
interface DailyUsage {
  total: number;               // 일일 한도 (plan 기반)
  used: number;                // 오늘 사용량
  bonusPoints: number;         // 보너스 포인트 (리셋 안됨)
  lastReset: string;           // 마지막 리셋 시각
  details: {
    search: number;            // 검색 사용량
    list: number;              // 리스트 조회
    script: number;            // 스크립트 추출
  };
  logs: [{                     // 최근 50건
    timestamp: string;
    type: 'search' | 'list' | 'script' | 'bonus';
    cost: number;
    details: string;
  }];
}
```

### 6.2 리셋 규칙
- **매일 오후 5시 (KST)** 자동 리셋
- `bonusPoints`는 리셋되지 않음 (관리자가 수동 부여)
- 리셋 시 `used = 0`, `details` 초기화

---

## 7. 알림 시스템

**Firestore Collection: `users/{uid}/notifications/{id}`**

```typescript
interface Notification {
  id: string;
  type: 'approval' | 'inquiry_reply' | 'notice' | 'bonus' | 'system';
  title: string;
  message: string;
  createdAt: string;
  read: boolean;
  link?: string;               // 클릭 시 이동할 경로
}
```

**알림 발송 시점:**
- 회원 승인 시
- 문의 답변 시
- 보너스 포인트 지급 시
- 공지사항 등록 시
- 멤버십 만료 임박 시

---

## 8. 서비스 함수 목록 (dbService)

새 프로젝트에서 구현해야 할 핵심 DB 함수:

```typescript
// === 유저 관리 ===
getUserData(uid: string): Promise<UserData>
updateUserData(uid: string, data: Partial<UserData>): Promise<void>
deleteUser(uid: string): Promise<void>
getAllUsers(): Promise<UserData[]>

// === 화이트리스트 ===
saveWhitelist(data: MembershipWhitelist): Promise<void>
checkWhitelist(channelId: string): Promise<WhitelistMatch | null>

// === 문의 ===
sendInquiry(inquiry: Inquiry): Promise<void>
getInquiries(): Promise<Inquiry[]>
replyToInquiry(id: string, reply: string, adminEmail: string): Promise<void>

// === 공지 ===
saveNotice(notice: Notice): Promise<void>
getNotices(): Promise<Notice[]>
deleteNotice(id: string): Promise<void>

// === 알림 ===
sendNotification(userId: string, notification: Notification): Promise<void>
getNotifications(userId: string): Promise<Notification[]>
markNotificationAsRead(userId: string, notificationId: string): Promise<void>

// === 포인트/쿼터 ===
getUsageFromDb(userId: string): Promise<DailyUsage>
updateUsageInDb(userId: string, usage: Partial<DailyUsage>): Promise<void>
grantBonusPoints(userId: string, points: number, reason: string): Promise<void>

// === 통계 ===
getAnalyticsOverview(period: 'daily' | 'weekly' | 'monthly'): Promise<DailyAnalytics[]>
trackPageView(page: string, userId?: string): Promise<void>
trackSession(userId: string): Promise<void>
```

---

## 9. Firestore 보안 규칙 (참고)

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // 유저 본인 문서만 읽기/쓰기
    match /users/{userId} {
      allow read, write: if request.auth.uid == userId;

      // 하위 컬렉션도 동일
      match /{subcollection}/{docId} {
        allow read, write: if request.auth.uid == userId;
      }
    }

    // 관리자만 접근
    match /system_data/{docId} {
      allow read: if request.auth != null;
      allow write: if get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
    }

    // 문의: 본인 작성 또는 관리자
    match /inquiries/{docId} {
      allow create: if request.auth != null;
      allow read, update: if request.auth != null &&
        (resource.data.userId == request.auth.uid ||
         get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin');
    }

    // 공지: 누구나 읽기, 관리자만 쓰기
    match /notices/{docId} {
      allow read: if request.auth != null;
      allow write: if get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
    }

    // 통계: 관리자만
    match /analytics/{path=**} {
      allow read: if get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
      allow write: if request.auth != null;
    }
  }
}
```

---

## 10. 제외 항목 (이 프로젝트에서 빼야 할 것)

다음은 TubeRadar 전용이므로 **새 프로젝트에 포함하지 않습니다:**

| 제외 기능 | 관련 Collection | 설명 |
|-----------|----------------|------|
| 추천 팩 관리 | `recommended_packages` | 채널 묶음 추천 |
| 추천 소재 관리 | `recommended_topics` | 콘텐츠 소재 추천 |
| 관련 유저 기능 | 패키지/소재 제안, 보상 | 유저가 팩/소재를 제안하고 보상받는 구조 |

관리자 대시보드의 탭에서 `packages`와 `topics` 탭만 제거하면 됩니다.

---

## 11. 참고: 원본 코드 위치

새 프로젝트 구현 시 참고할 TubeRadar 소스 파일:

| 역할 | 파일 경로 |
|------|----------|
| 관리자 대시보드 | `src/components/AdminDashboard.tsx` |
| 인증 컨텍스트 | `src/contexts/AuthContext.tsx` |
| 승인 대기 화면 | `src/components/PendingApproval.tsx` |
| DB 서비스 | `services/dbService.ts` |
| 포인트 서비스 | `services/usageService.ts` |
| Firebase 설정 | `src/lib/firebase.ts` |
| 타입 정의 | `types.ts` |
| 메인 앱 (라우팅) | `App.tsx` |
