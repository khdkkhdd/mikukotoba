# 단어 저장 시 로컬 파티션 버전 즉시 bump (markDirty)

Status: accepted
Date: 2026-02-20

## Context

확장프로그램에서 단어 저장 후 Drive push가 누락되는 버그 발견. 원인: `pushPartition`이 500ms `setTimeout` 디바운스를 사용하는데, Service Worker가 대기 중 종료되면 push가 실행되지 않음. 이후 `pushAll`은 `localVersion > remoteVersion`일 때만 push하지만, 로컬 버전은 push 성공 시에만 갱신되므로 양쪽 버전이 동일하게 남아 복구 불가.

## Decision

`DriveSync.markDirty(date)` 메서드를 추가하여 단어 저장(VOCAB_SAVE/UPDATE/DELETE) 시 즉시 로컬 `partitionVersions[date]`를 `Date.now()`로 bump한다. 이를 통해 디바운스 push가 실패해도 로컬 버전이 리모트보다 높아져 다음 `pushAll` 호출 시 복구된다.

## Consequences

### Positive
- SW 종료로 디바운스 push가 실패해도 데이터 누락 없음
- 다음 수동/자동 pushAll에서 자동 복구
- 기존 push 성공 경로에 영향 없음 (push가 더 높은 버전으로 덮어씀)

### Negative
- 저장마다 `chrome.storage.local` 쓰기 1회 추가 (미미한 오버헤드)

## Alternatives Considered

- **pushAll에서 content 비교**: 버전 대신 실제 엔트리를 비교. 매번 Drive에서 읽어와야 해서 비용이 큼.
- **VocabStorage.addEntry 내부에서 버전 bump**: sync 관심사가 storage 레이어에 침투. 결합도 증가.

## References

- Plan: context.md
- Related: `packages/extension/src/core/drive-sync.ts`, `packages/extension/src/background/service-worker.ts`
