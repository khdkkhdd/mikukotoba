# Goal

모바일 앱의 자동 동기화 및 학습 UX 개선.

1. Cold start 시 자동 pull 추가
2. 자동 sync 후 마지막 동기화 시간 반영
3. 학습 대기 화면에서 실시간 카운트다운 + 자동 재개

# Research

## 모바일 동기화 구조

- `SyncManager` (`services/sync-manager.ts`): 모듈 레벨 상태로 dirty 추적, flush/pull 관리
- `initSyncManager(db)`: `_layout.tsx`에서 앱 시작 시 호출. `AppState` 리스너 등록
- `handleAppStateChange`: background→flush, foreground→3종 pull (vocab/FSRS/review)
- `fullSync`: 수동 동기화 (설정 탭 버튼). flush→pull→push→`commitSyncMeta`
- `lastSyncTime`: `useSettingsStore`(UI) + `setSyncMeta`(DB 영속화) 이중 저장

## Cold start 시 pull 부재

- `initSyncManager`은 `AppState` 리스너만 등록, 초기 pull 없음
- Cold start는 이미 `active` 상태로 시작 → state change 이벤트 미발생 → pull 안 됨

## lastSyncTime 업데이트 범위

- 기존: `fullSync` (수동) 에서만 업데이트
- `handleAppStateChange` (포그라운드 복귀) 에서는 미업데이트
- `settings.tsx:43-44`에서 수동 동기화 시 store + DB 모두 업데이트하는 패턴 확인

## 학습 대기 화면 (SrsSession.tsx)

- `selectNextCard` → 'waiting' view: 모든 큐 비었고 waitingQueue만 남을 때
- 기존: `const now = Date.now()` (렌더 스냅샷, 매초 갱신 안 됨)
- 기존 TICK: `setTimeout`으로 정확히 due 시점에 1회 발화 → 카드 승격은 됐지만 카운트다운 시각 변화 없음
- `selectNextCard` 내부에서 `promoteWaiting(state, now)` 호출 — 순수 함수, session state 미변경
- `applyGrade`는 `learningQueue`/`reviewQueue`/`newQueue`에서만 카드 검색 → waitingQueue에 있으면 채점 무시

# Plan

## Decisions

- Cold start pull: `initSyncManager` 내에서 fire-and-forget async로 기존 foreground pull과 동일 패턴
- lastSyncTime: 자동 pull 성공 시에도 store + DB 업데이트. `commitSyncMeta`는 경량 pull 설계상 생략 (기존 foreground pull과 동일)
- 카운트다운: `useState(Date.now())` + `setInterval(1000)` — waiting 큐 있을 때만 활성화
- TICK dispatch: `setInterval` 콜백에서 `setNow` + `dispatch TICK` 동시 호출 (React 18 배치로 1회 렌더)
- AppState 복귀: `setNow` + `dispatch TICK` 모두 필요 — TICK 없으면 session state와 뷰 불일치로 채점 실패

## Steps

완료.

# Progress

- [x] `initSyncManager`에 cold start pull 추가 (`sync-manager.ts:160-183`)
- [x] `handleAppStateChange` + cold start pull에 `lastSyncTime` 업데이트 추가
- [x] `SrsSession.tsx` 카운트다운: `setTimeout` → `setInterval(1000)` + `useState(now)` 전환
- [x] AppState 복귀 시 TICK dispatch 누락 버그 수정
- [x] 미사용 import (`getNextWaitingTime`, `timerRef`) 정리
- [x] tsc --noEmit 통과
- [ ] 커밋
