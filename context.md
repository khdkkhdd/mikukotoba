# Goal

모바일 앱 기능 확장 및 UI 일관성 개선.

- review_log Drive 동기화로 기기 간 학습 통계 통합
- 전체 탭 UI 레이아웃 일관성 확보

# Research

## 앱 구조

```
packages/mobile/
  app/(tabs)/_layout.tsx    # 5탭: Home, 단어, 학습, 통계, 설정 (headerShown: false)
  app/(tabs)/index.tsx      # 홈 — paddingTop: 80
  app/(tabs)/vocab.tsx      # 단어장 — paddingTop: 80, sticky sectionHeader bg 처리
  app/(tabs)/study.tsx      # 학습 — paddingTop: 80
  app/(tabs)/stats.tsx      # 통계 탭 (StatsScreen)
  app/(tabs)/settings.tsx   # 설정 — paddingTop: 80
  src/study/StatsScreen.tsx # 통계 — paddingTop: 80, 좌측 정렬 타이틀
  src/study/SrsSession.tsx  # SRS 학습 (markFsrsDirty + markReviewLogDirty)
  src/components/Calendar.tsx
  src/components/theme.ts
  src/db/queries.ts         # getAllReviewLogs, replaceAllReviewLogs 추가
  src/db/schema.ts          # review_log 테이블 (vocab_id FK, rating, reviewed_at)
  src/services/sync.ts      # pushReviewLogs (merge-before-push), pullReviewLogs
  src/services/sync-manager.ts  # dirtyReviewLog 플래그, flush/pull/fullSync 통합
```

## DB 스키마

- `review_log`: id (autoincrement), vocab_id (FK→vocab), rating, reviewed_at (ISO)
- `card_state`: vocab_id (FK→vocab), state, due, stability, ...

## Drive 동기화 파일 (shared)

- `review_logs.json` — `DriveReviewLogState { logs, version }`
- `fsrs_state.json` — `DriveFsrsState { cardStates, version }`
- `sync_metadata.json`, `vocab_*.json` — 기존 vocab/meta 동기화

## 공유 패키지 (shared)

- `DriveReviewLogEntry { vocab_id, rating, reviewed_at }` 타입
- `mergeReviewLogs()` — Set 기반 `vocab_id|reviewed_at` 중복 제거, 시간순 정렬
- `DRIVE_REVIEW_LOG_FILE` 상수

## UI 레이아웃 규칙

- 모든 탭: `paddingTop: 80`, 타이틀 `fontSize.xxl (28)`, `fontWeight: '700'`, 좌측 정렬
- 탭 헤더(네비게이션 바) 제거: `_layout.tsx`에서 `headerShown: false`
- 단어장 sectionHeader: `backgroundColor: colors.bg`, `paddingTop` (margin 대신) 사용

# Plan

## Decisions

- review_log 동기화: append-only 데이터 → merge-before-push 패턴 (합집합 보장)
- 단일 파일 `review_logs.json` (연 ~1.2MB, 파티션 불필요)
- FSRS push/pull과 동일 시점 수행 (추가 트리거 없음)
- 탭 헤더 제거 → 각 화면 자체 타이틀로 통일

## Steps

구현 완료. 커밋 대기.

# Progress

- [x] review_log Drive 동기화 (shared 타입/머지 + mobile DB쿼리/push/pull/sync-manager)
- [x] drive-api.ts TypeScript 에러 수정 (resp.json() 타입 단언)
- [x] 탭 헤더 제거 (headerShown: false)
- [x] 전체 탭 paddingTop 80 통일
- [x] 전체 탭 타이틀 fontSize.xxl 통일
- [x] 통계 화면 타이틀 좌측 정렬로 변경
- [x] 단어장 sticky sectionHeader 배경색 + paddingTop 처리
