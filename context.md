# Goal

Drive Sync 안정성 개선: vocab 파일 push 성공 후 metadata write 실패 시 고아 파일 발생 → 새 기기에서 pull 불가 버그 해결. Extension + Mobile 양쪽 동일 패턴 수정.

# Research

## 근본 원인

- `pushPartitionImmediate` (Extension) / `pushToDrive` (Mobile): vocab 파일을 Drive에 성공적으로 write한 뒤, metadata write(`Promise.all` 또는 `updateRemoteMeta`)가 실패하면 로컬 meta도 저장되지 않아 버전 정보 유실
- 다음 sync에서 해당 파일의 localVersion/remoteVersion 모두 0 → dirty로 감지 안 됨 → 고아 파일 발생
- Mobile pull에서는 `remoteMeta.partitionVersions`만 참조하므로 metadata에 없는 파일 발견 불가

## Sync 경로 구조

- **ctx 경로** (`fullSync`): `createSyncContext` → `listFiles` 1회로 `fileIdMap` 구성 → pull/push에 ctx 전달 → `commitSyncMeta`로 일괄 meta 업데이트
- **경량 경로** (`flush`, debounce 30초): ctx 없이 push 함수 직접 호출 → 각 함수가 `updateRemoteMeta`로 개별 meta 업데이트. `listFiles` 호출 안 함
- 둘 다 활성 경로. "레거시"가 아님

## 검증 완료 사항

- 로컬 meta 조기 저장 → Drive 실패 시 `localV > remoteV`로 다음 sync에서 재시도됨
- `mergeEntries`가 tombstone 필터링 → 삭제 항목 부활 없음
- `commitSyncMeta`: freshMeta 재읽기 + Math.max 머지 → 버전 역행 방지
- `isPulling` 가드: cold start, foreground 복귀, fullSync 세 경로 간 동시 실행 방지
- `pullFromDrive`는 실제로 항상 ctx와 함께 호출됨 (fullSync, foreground, cold start 모두)

# Plan

## Decisions

- FSRS/ReviewLog 파티션도 동일 패턴 적용 (vocab만이 아닌 전체 push 경로 보호)
- `isPulling` 가드를 sync-manager에 추가하여 동시 pull 방지 (기존 `isFlushing`은 flush만 보호)
- Extension/Mobile initDates 전략 차이 유지: Extension은 merge 후 push back, Mobile은 pull only (dirtyVocabDates로 다음 flush 때 push)

## Steps

구현 완료. 커밋 대기.

# Progress

## 완료

- A. Extension `pushPartitionImmediate`: `saveLocalMeta`를 Drive write 앞으로 이동, `Promise.all` try-catch
- B. Mobile `pullFromDrive`: `ctx.fileIdMap`에서 vocab 파일 발견 + initDates 고아 파일 pull
- C. Mobile `pushToDrive` 경량 경로: `saveLocalSyncMeta`를 Drive write 앞으로 이동, try-catch
- D. Mobile sync-manager: `handleAppStateChange(active)` + `initSyncManager`에서 pull 후 `commitSyncMeta` 호출
- E. Mobile `pushFsrsPartitions`/`pushReviewLogPartitions` 경량 경로: 동일 패턴 적용
- F. Mobile sync-manager `isPulling` 가드 추가
- G. 주석 정리: "레거시 경로" → "경량 경로"
- 전체 점검 완료 (Extension build + Mobile tsc 통과)

## 변경 파일

- `packages/extension/src/core/drive-sync.ts`
- `packages/mobile/src/services/sync.ts`
- `packages/mobile/src/services/sync-manager.ts`
