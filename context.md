# Goal

확장프로그램 Google Drive 동기화 문제 디버깅 및 수정.

1. ~~OAuth silent refresh 실패로 매번 재로그인 필요한 문제~~ (완료)
2. 단어 추가 후 Drive에 push가 안 되는 문제

# Research

## 근본 원인 (확인됨)

- 단어 저장 시 `pushPartition`이 500ms `setTimeout` 디바운스 사용
- Service Worker가 디바운스 대기 중 종료되면 push 미실행
- `pushAll`은 `localVersion > remoteVersion`일 때만 push하는데, 로컬 버전은 push 성공 시에만 갱신됨
- 결과: push 미실행 → 로컬/리모트 버전 동일 → `pushAll`도 건너뜀 → 데이터 영구 누락

## 진단 결과

- `SYNC_DIAGNOSE`: 로컬 22개, Drive 19개 (3개 누락)
- 양쪽 `partitionVersions` 동일 → `pushAll`이 "변경 없음"으로 판단
- 수동 `SYNC_PUSH` 실행해도 `pushed: 0` 반환

## 동기화 흐름 (확장프로그램)

- 단어 저장: `VOCAB_SAVE` → `VocabStorage.addEntry` → `DriveSync.pushPartition(dateAdded)` (fire-and-forget)
- `pushPartition`: 500ms 디바운스 → `pushPartitionImmediate`
- `pushPartitionImmediate`: `getValidToken()` → Drive appData에 파티션 파일 업로드
- `pushAll`: `localVersion > remoteVersion` 필터 → 해당 날짜만 push

# Plan

## Decisions

- OAuth prompt: `consent` → `select_account` 변경 완료
- `DriveSync.markDirty(date)` 추가: 단어 저장 시 즉시 로컬 버전 bump → SW 종료되어도 다음 pushAll에서 복구 가능

## Steps

- [ ] 기존 누락분 수동 복구: 콘솔에서 로컬 버전 bump 후 SYNC_PUSH 실행
- [ ] 401 에러 핸들링 추가 (잠재적 버그, 미착수)

# Progress

- [x] OAuth prompt 변경 (`drive-auth.ts`)
- [x] 근본 원인 파악: SW 종료 시 디바운스 push 미실행 + pushAll 버전 비교 로직
- [x] `DriveSync.markDirty()` 추가, VOCAB_SAVE/UPDATE/DELETE 핸들러에서 호출
- [x] 빌드 통과
- [ ] 기존 누락분 수동 복구 대기 중 (사용자가 콘솔 스크립트 실행 필요)
