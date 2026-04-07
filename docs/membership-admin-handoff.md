# 멤버십 관리 관리자 기능 전달 문서

이 문서는 현재 TubeRadar에 구현된 `멤버십 관리 + 관리자 기능`을 다른 홈페이지에 동일하게 이식하기 위한 전달용 문서다.

중요:
- 기준 구현은 실제 코드다. 기존 명세 문서보다 이 문서를 우선한다.
- 이번 이식 범위에서 `추천 팩 관리`, `추천 소재 관리`는 제외한다.
- 핵심은 `Firebase Auth + Firestore + 관리자 대시보드 + 화이트리스트 기반 자동 승인` 구조를 그대로 맞추는 것이다.

## 1. 구현 범위

반드시 동일하게 구현해야 하는 화면/기능:

1. Google 로그인
2. 신규 회원 `pending` 상태 생성
3. 승인 대기 화면
4. YouTube 채널 ID 입력 후 화이트리스트 자동 승인
5. 관리자 대시보드
6. 사용자 관리
7. 문의 수신함 및 답변
8. 멤버십 화이트리스트 CSV 업로드/수동 추가/삭제
9. 공지사항 관리 + 한줄 공지
10. 통계 조회

## 2. 기술 구성

- 프론트엔드: React + TypeScript
- 인증: Firebase Authentication, Google OAuth 팝업 로그인
- DB: Firestore
- 실시간 반영: `onSnapshot`

## 3. 핵심 접근 제어

기준 코드는 [App.tsx](/Users/seunghyohyun/project/work/tuberadar/App.tsx#L3328) 와 [App.tsx](/Users/seunghyohyun/project/work/tuberadar/App.tsx#L3540) 이다.

동작 규칙:
- 비로그인: 로그인 화면
- `role === 'pending'`: 승인 대기 화면 표시
- `role !== 'admin'` 이고 `expiresAt` 지난 경우: 만료 화면 표시
- 관리자 대시보드는 현재 코드상 `admin` 뿐 아니라 `approved` 도 열 수 있다

주의:
- 운영 정책상 진짜 관리자만 접근시키려면 `approved` 허용 여부를 먼저 결정해야 한다.
- 현재 앱에는 특정 이메일을 강제로 `admin` 으로 보는 하드코딩이 있다. 다른 사이트로 이식 시 제거하거나 환경설정으로 분리하는 것이 맞다.

## 4. 사용자 문서 스키마

기준 코드는 [AuthContext.tsx](/Users/seunghyohyun/project/work/tuberadar/src/contexts/AuthContext.tsx#L67) 와 [AdminDashboard.tsx](/Users/seunghyohyun/project/work/tuberadar/src/components/AdminDashboard.tsx#L22) 이다.

`users/{uid}`

```ts
{
  email: string | null
  displayName: string | null
  photoURL: string | null
  role: 'admin' | 'approved' | 'pending' | 'regular' | 'pro' | 'guest'
  plan: 'free' | 'silver' | 'gold' | 'admin' | 'general'
  createdAt: string // ISO
  lastLoginAt: string // ISO
  expiresAt: string | null // ISO
  channelId: string | null
  membershipTier?: string | null
  adminMemo?: string
  submittedAt?: string // 승인 대기 화면에서 채널 ID 제출 시
  hiddenItemIds?: string[]
}
```

실무적으로 정리하면:
- 자동 승인 로직은 `role: approved + plan: silver|gold` 를 사용한다.
- 일부 관리자 수동 처리에서는 `role: regular|pro` 도 사용하고 있다.
- 즉, 다른 사이트에서 동일 구현이 목표라면 `role` 과 `plan` 을 둘 다 유지해야 한다.

권장:
- 신규 이식에서는 역할을 `admin | approved | pending` 으로 단순화하고,
- 등급은 `plan` 으로만 관리하는 편이 낫다.
- 다만 “현재 사이트와 완전 동일 동작”이 목표면 `regular`, `pro` 도 허용해야 한다.

## 5. 로그인 후 초기 생성 규칙

기준 코드는 [AuthContext.tsx](/Users/seunghyohyun/project/work/tuberadar/src/contexts/AuthContext.tsx#L67) 이다.

신규 로그인 시:
- `users/{uid}` 없으면 생성
- 기본값:
  - `role: 'pending'`
  - `plan: 'free'`
  - `expiresAt: null`
  - `channelId: null`

기존 회원 로그인 시:
- `lastLoginAt`, `displayName`, `photoURL` 갱신

## 6. 승인 대기 화면 동작

기준 코드는 [PendingApproval.tsx](/Users/seunghyohyun/project/work/tuberadar/src/components/PendingApproval.tsx#L56) 이다.

필수 기능:
- 사용자가 YouTube 채널 ID를 입력
- `youtube.com/channel/...` URL 붙여넣기도 허용
- `system_data/membership_whitelist.memberDetails[].id` 와 일치하는지 확인
- 동일 채널 ID가 이미 다른 사용자에게 연결돼 있으면 거절
- 통과하면 현재 사용자 문서에 `channelId`, `submittedAt` 저장
- 이후 실제 승인/등급 반영은 `AuthContext` 의 실시간 감시 로직이 처리

즉:
- 승인 대기 화면은 "즉시 role 변경"을 하지 않는다
- 채널 ID를 저장하고
- 별도 실시간 로직이 화이트리스트를 보고 승인한다

## 7. 멤버십 화이트리스트 문서

기준 코드는 [AdminDashboard.tsx](/Users/seunghyohyun/project/work/tuberadar/src/components/AdminDashboard.tsx#L545) 와 [AuthContext.tsx](/Users/seunghyohyun/project/work/tuberadar/src/contexts/AuthContext.tsx#L115) 이다.

`system_data/membership_whitelist`

```ts
{
  validChannelIds: string[]
  memberDetails: Array<{
    id: string
    name: string
    tier: string
    tierDuration: string
    totalDuration: string
    status: string
    lastUpdate: string
    remainingDays?: string
  }>
  updatedAt: string
  updatedBy?: string
  count?: number
}
```

핵심 키:
- 승인 매칭 기준은 `memberDetails[].id === users/{uid}.channelId`
- `tier` 로 silver/gold 판정
- `remainingDays` 또는 `lastUpdate` 로 만료일 계산

## 8. 자동 승인 로직

기준 코드는 [AuthContext.tsx](/Users/seunghyohyun/project/work/tuberadar/src/contexts/AuthContext.tsx#L111) 이다.

실행 시점:
- 로그인 이후 `users/{uid}` 를 `onSnapshot` 으로 구독
- 사용자 문서에 `channelId` 가 있으면 화이트리스트와 대조

로직:
1. `channelId` 가 화이트리스트에 존재하면 승인
2. `tier` 문자열에 `gold`, `pro`, `골드` 포함 시 `plan = gold`
3. `tier` 문자열에 `silver`, `regular`, `실버` 포함 시 `plan = silver`
4. `role` 은 기본적으로 `approved`
5. 단 기존 role 이 `admin` 이면 유지

만료일 계산 우선순위:
1. `remainingDays` 가 있으면 현재 시점 + 남은 일수
2. 없으면 `lastUpdate` 의 일자를 기준으로 다음 월 갱신일 계산
3. 둘 다 애매하면 `lastUpdate + 32일`

추가 동작:
- 승인/업그레이드 시 `users/{uid}/history` 에 `membership_sync` 기록
- 관리자들에게 알림 전송
- 세션 기준 환영 팝업 표시

화이트리스트에서 빠진 경우:
- 현재 코드에서는 `currentRole === 'approved'` 인 사용자만 `pending + free` 로 내린다
- `regular`, `pro` 는 여기서 자동 강등 대상이 아니다

이 부분은 다른 사이트에서 그대로 둘지, `approved|regular|pro` 전체를 강등할지 정책 결정이 필요하다.

## 9. 사용자 관리 탭

기준 코드는 [AdminDashboard.tsx](/Users/seunghyohyun/project/work/tuberadar/src/components/AdminDashboard.tsx#L1128) 부근이다.

필수 기능:
- 전체 사용자 조회
- 필터: 전체, 승인, 대기, 관리자
- 정렬: 만료일, 역할, 최근 로그인
- 선택 후 일괄 작업
- 개별 수정 모달
- 관리자 메모 저장
- 사용자 활동 기록 조회
- 사용자 활동 데이터 초기화
- 사용자 삭제

개별 수정에서 바꿀 수 있는 값:
- `role`
- `plan`
- `expiresAt`

활동 초기화 대상:
- `users/{uid}/channels`
- `users/{uid}/groups`
- `users/{uid}/notifications`
- `users/{uid}/history`
- `inquiries` 중 `userId == uid`

초기화 후 새 `history` 로그 1건 생성

## 10. 문의 수신함

기준 코드는 [dbService.ts](/Users/seunghyohyun/project/work/tuberadar/services/dbService.ts#L195) 와 [dbService.ts](/Users/seunghyohyun/project/work/tuberadar/services/dbService.ts#L219) 이다.

`inquiries/{id}`

```ts
{
  userId: string
  userName: string
  userEmail: string | null
  content: string
  createdAt: number | string
  isAnswered: boolean
  type: 'general' | 'approval_request'
  answer?: string
  answeredAt?: number
}
```

관리자 답변 시:
- 문의 문서에 `isAnswered`, `answer`, `answeredAt` 저장
- 사용자 `notifications` 서브컬렉션에 알림 생성
- `admin_message_logs` 에도 발송 로그 남김

## 11. 알림 구조

기준 코드는 [dbService.ts](/Users/seunghyohyun/project/work/tuberadar/services/dbService.ts#L133) 이다.

`users/{uid}/notifications/{notificationId}`

```ts
{
  id: string
  userId: string
  title: string
  message: string
  type: 'info' | string
  isRead: boolean
  createdAt: number
}
```

알림 사용처:
- 문의 답변 도착
- 신규 회원 승인
- 회원 등급 변경
- 관리자 개별/전체 메시지

## 12. 관리자 메시지 로그

기준 코드는 [dbService.ts](/Users/seunghyohyun/project/work/tuberadar/services/dbService.ts#L163) 이다.

`admin_message_logs`

```ts
{
  recipientId: string
  recipientName: string
  message: string
  adminId: string
  type: 'individual' | 'all'
  createdAt: number
}
```

## 13. 멤버십 관리 탭

기준 코드는 [AdminDashboard.tsx](/Users/seunghyohyun/project/work/tuberadar/src/components/AdminDashboard.tsx#L404) 와 [AdminDashboard.tsx](/Users/seunghyohyun/project/work/tuberadar/src/components/AdminDashboard.tsx#L2752) 이다.

필수 기능:
- CSV 업로드
- 등록 회원 수/최종 업데이트 표시
- 이름/ID 검색
- 정렬: 이름, 등급, 유지기간, 업데이트
- 개별 수동 추가
- 개별 삭제
- 업로드 후 추가/제거 diff 모달 표시
- CSV로 사라진 사용자는 즉시 강등

CSV 파싱 규칙:
- UTF-8 우선, 실패 시 EUC-KR fallback
- 콤마/탭 자동 구분
- 헤더 행 자동 탐지
- `프로필 링크` 에서 `channel/UC...` 패턴 추출

기대 컬럼 예시:
- 회원
- 프로필에 연결된 링크
- 현재 등급
- 등급을 유지한 기간
- 활동한 총 기간
- 최종 업데이트
- 타임스탬프
- 남은 기간 또는 만료 관련 컬럼

## 14. 수동 멤버 추가/삭제

기준 코드는 [AdminDashboard.tsx](/Users/seunghyohyun/project/work/tuberadar/src/components/AdminDashboard.tsx#L1387) 와 [AdminDashboard.tsx](/Users/seunghyohyun/project/work/tuberadar/src/components/AdminDashboard.tsx#L1472) 이다.

수동 추가:
- 화이트리스트에 즉시 반영
- 입력값: 이름, ID, tier, remainingDays
- 이미 가입한 사용자를 찾으면 즉시 권한도 반영
- 사용자 매칭 기준:
  - `channelId` 정확히 일치
  - 또는 email 전체 일치
  - 또는 email 앞부분 일치

수동 추가 시 사용자 권한:
- 실버 계열: `role = regular`, `plan = silver`
- 골드 계열: `role = pro`, `plan = gold`

수동 삭제:
- 화이트리스트에서 제거
- 일치 사용자 찾으면 `role = approved`, `plan = free`, `membershipTier = null`, `expiresAt = null`

중요:
- 자동 승인 로직은 `approved + silver|gold`
- 수동 추가 로직은 `regular|pro + silver|gold`
- 완전 동일 구현이 목표면 이 차이도 그대로 반영해야 한다
- 하지만 유지보수성 때문에 다른 사이트에서는 `approved` 하나로 통일하는 것을 권장한다

## 15. 공지사항

기준 코드는 [AdminDashboard.tsx](/Users/seunghyohyun/project/work/tuberadar/src/components/AdminDashboard.tsx#L1206) 와 [dbService.ts](/Users/seunghyohyun/project/work/tuberadar/services/dbService.ts#L509) 부근이다.

구조가 두 가지다.

일반 공지:
- 컬렉션: `notices`
- 문서 필드:

```ts
{
  title: string
  content: string
  isActive: boolean
  imageUrl?: string
  createdAt: string
  updatedAt: string
}
```

한줄 공지:
- 문서: `notices/_announcement`

```ts
{
  text: string
  isActive: boolean
  link?: string
  createdAt?: string
  updatedAt: number
}
```

## 16. 통계

기준 코드는 [dbService.ts](/Users/seunghyohyun/project/work/tuberadar/services/dbService.ts#L300) 이후와 `getAnalyticsOverview` 구현이다.

현 구조:
- `analytics_sessions`
- `analytics_pageviews`

관리자 통계에서는:
- 관리자 세션 제외
- 기간별 방문자/세션/페이지뷰 집계
- 등급별 방문자 집계
- 상위 페이지 집계

같이 이식해야 하는 것은:
- 관리자 탭에서 최근 1일, 7일, 30일 기준 조회
- 세션 수, 방문자 수, 페이지뷰 수, 평균 체류시간, 상위 페이지

## 17. 포인트/쿼터 정책

기준 코드는 [dbService.ts](/Users/seunghyohyun/project/work/tuberadar/services/dbService.ts#L300) 과 [dbService.ts](/Users/seunghyohyun/project/work/tuberadar/services/dbService.ts#L391) 이다.

일일 한도:
- free/general: 1000
- silver: 2000
- gold: 5000
- admin: 10000

저장 위치:
- `users/{uid}/usage/daily`

필드 예시:

```ts
{
  total: number
  used: number
  bonusPoints: number
  lastReset: string
  details: {
    search: number
    list: number
    script: number
  }
  logs: Array<{
    timestamp: string
    type: string
    cost: number
    details: string
  }>
}
```

## 18. 다른 개발자에게 전달할 때 꼭 포함해야 할 구현 지시

아래 문구대로 전달하면 된다.

1. 로그인 후 모든 회원은 `users/{uid}` 에 먼저 `pending/free` 로 생성해 주세요.
2. 승인 처리는 관리자 버튼이 아니라 `users.channelId` 와 `system_data/membership_whitelist.memberDetails[].id` 를 비교하는 자동 승인 구조로 맞춰 주세요.
3. 승인 대기 화면에서는 채널 ID 중복 검사를 반드시 넣어 주세요. 같은 채널 ID를 여러 계정이 쓰면 안 됩니다.
4. 멤버십 CSV는 단순 ID 리스트가 아니라 `memberDetails` 전체를 저장해야 합니다. 그래야 등급, 갱신일, 남은 기간 계산이 됩니다.
5. 화이트리스트 업로드 후 제거된 회원은 즉시 강등해 주세요.
6. 관리자 화면은 최소 `사용자 관리 / 문의 수신함 / 멤버십 관리 / 공지사항 / 통계` 5개 탭으로 구성해 주세요.
7. 문의 답변은 문의 문서만 수정하지 말고 사용자 알림까지 같이 생성해 주세요.
8. 사용자 수정 이력과 멤버십 동기화 이력은 `users/{uid}/history` 에 남겨 주세요.
9. 현재 사이트는 `role` 과 `plan` 이 혼용되어 있으니, 완전 동일 구현이 목표면 그대로 반영해 주세요.
10. 다만 새 사이트에서 구조를 정리할 수 있다면 `role=권한`, `plan=등급` 으로 단순화해도 됩니다. 그 경우 자동 승인/수동 추가/강등 로직을 모두 같은 기준으로 다시 맞춰 주세요.

## 19. 이식 전에 먼저 확인할 정책 항목

이건 구현 전에 반드시 결정해야 한다.

1. 관리자 대시보드를 `approved` 사용자도 열 수 있게 할지
2. 특정 이메일 admin 하드코딩을 유지할지
3. `regular/pro` 역할을 그대로 유지할지, `approved` 로 통일할지
4. 화이트리스트 제거 시 `approved` 만 강등할지, `regular/pro` 도 함께 강등할지
5. 만료 정책을 `remainingDays 우선` 으로 유지할지

## 20. 기준 코드 위치

- 인증/자동 승인: [AuthContext.tsx](/Users/seunghyohyun/project/work/tuberadar/src/contexts/AuthContext.tsx)
- 승인 대기 화면: [PendingApproval.tsx](/Users/seunghyohyun/project/work/tuberadar/src/components/PendingApproval.tsx)
- 관리자 대시보드: [AdminDashboard.tsx](/Users/seunghyohyun/project/work/tuberadar/src/components/AdminDashboard.tsx)
- 공통 DB 함수: [dbService.ts](/Users/seunghyohyun/project/work/tuberadar/services/dbService.ts)
- 접근 제어/라우팅: [App.tsx](/Users/seunghyohyun/project/work/tuberadar/App.tsx)

