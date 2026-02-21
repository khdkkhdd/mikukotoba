# Drive Sync: 로컬 meta 조기 저장 + 고아 파일 발견으로 안정성 개선

Status: accepted
Date: 2026-02-21

## Context

vocab 파일 push 성공 후 Drive metadata write가 실패하면 로컬 meta도 저장되지 않아 버전 정보가 유실된다. 다음 sync에서 해당 파일의 localVersion/remoteVersion이 모두 0이 되어 dirty로 감지되지 않고, 새 기기에서 pull 불가한 고아 파일이 발생한다. Extension과 Mobile 양쪽에 동일 패턴이 존재했다.

## Decision

1. **로컬 meta 조기 저장**: Drive metadata write 전에 `saveLocalMeta`/`saveLocalSyncMeta`를 호출. Drive write를 try-catch로 감싸서 실패해도 로컬에는 `localVersion > remoteVersion` 상태가 유지되어 다음 sync에서 재시도.

2. **고아 파일 발견**: Mobile `pullFromDrive`에서 `ctx.fileIdMap`의 `vocab_*.json` 파일명을 파싱하여 `allDates`에 추가. `initDates` (양쪽 version 0) 카테고리를 만들어 Drive에 파일만 있는 경우 pull.

3. **`isPulling` 가드**: sync-manager에 추가하여 cold start, foreground 복귀, fullSync 간 동시 pull 방지.

4. **`commitSyncMeta` 호출 추가**: `handleAppStateChange(active)`와 `initSyncManager` cold start에서 pull 후 `versionPatches`가 있으면 호출하여 Drive meta에 반영.

5. **FSRS/ReviewLog 경량 경로에도 동일 패턴 적용**: `pushFsrsPartitions`/`pushReviewLogPartitions`의 ctx 미사용 경로에서도 로컬 먼저 저장 + try-catch.

## Consequences

### Positive
- Drive metadata write 실패 시 고아 파일 발생 방지
- 새 기기에서 기존 데이터 정상 pull 가능
- 동시 pull로 인한 불필요한 Drive write 방지

### Negative
- Drive write 실패 시 로컬과 Drive 간 일시적 불일치 (다음 sync에서 해소)
- `isPulling` 가드로 인해 동시 요청 시 후발 pull이 스킵됨

## Alternatives Considered

- **Push + meta write를 트랜잭션으로 묶기**: Drive API에 트랜잭션 지원이 없어 불가.
- **Push 전에 meta를 먼저 쓰기**: 파일이 아직 없는데 버전을 기록하면 pull 시 파일 not found 에러 발생.
- **Locking으로 race condition 방지**: `pushPartitionImmediate`와 `pushAll` 간 Math.max 머지로 충분히 보호됨. 복잡한 locking 대비 효과 미미.

## References

- Plan: context.md
- Related: `packages/extension/src/core/drive-sync.ts`, `packages/mobile/src/services/sync.ts`, `packages/mobile/src/services/sync-manager.ts`, `packages/shared/src/sync-context.ts`
