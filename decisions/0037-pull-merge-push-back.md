# Pull-merge 후 push-back으로 양방향 동기화 보장

Status: accepted
Date: 2026-02-20

## Context

익스텐션 `pull()`에서 `remoteVersion > localVersion`일 때 remote와 local을 merge한 뒤 로컬에만 저장하고 Drive에 push하지 않았다. 로컬에서 추가한 태그(newer timestamp)가 merge에서 살아남지만 Drive에는 반영되지 않아 상대 기기에서 영원히 보이지 않는 문제가 발생했다. versions이 동일해지면 다음 pull에서도 skip되어 로컬 변경이 Drive에 올라갈 기회가 없었다.

## Decision

Pull-merge 후 `localEntries.length > 0`이면 merged 결과를 즉시 Drive에 push-back한다. push-back 시 새 version을 발급하고 Drive 메타도 함께 업데이트한다. 추가로 `SYNC_PUSH` 핸들러(`DriveSync.pushAll`)를 도입하여 version이 이미 equalize된 상태에서도 수동 복구할 수 있게 했다. pull() 내에서 `pushPartitionImmediate` 호출 후에는 `meta = await getLocalMeta()`로 재로드하여 meta staleness 문제도 해결했다.

## Consequences

### Positive
- 양방향 동기화 보장: 어느 쪽에서 편집하든 merge 결과가 Drive에 반영됨
- 태그, timestamp 등 로컬 변경이 pull 시에도 Drive에 올라감
- SYNC_PUSH로 데이터 불일치 시 수동 복구 가능
- meta staleness 해소: pushPartitionImmediate 후 최신 meta 반영

### Negative
- Pull 시 추가 Drive write 발생 (partition + meta): 파티션당 API 호출 1-2회 추가
- localEntries가 있지만 실제 merge에 기여하지 않은 경우에도 push (불필요한 write 가능)

## Alternatives Considered

- **Pull 후 별도 push-all 호출**: fullSync처럼 pull → pushAll 순서. 모든 날짜를 push하므로 변경 없는 파티션도 push하여 낭비가 크고, 익스텐션 pull은 독립 호출이라 적용 어려움.
- **Merge 결과를 remote와 비교 후 조건부 push**: 정확하지만 비교 로직이 복잡하고 (배열 내용 비교), 추가 Drive read 필요. localEntries.length > 0 체크가 충분히 정확함.
- **Local version을 bump하여 다음 pull에서 push 트리거**: 간접적이고 다음 pull까지 반영 지연. 즉시 push-back이 더 직관적.

## References

- Plan: context.md
- Related: decisions/0035-drive-sync-merge-before-push.md, decisions/0036-sync-merge-direction-and-extension-merge-before-push.md
- Files: `packages/extension/src/core/drive-sync.ts` (pull, pushAll), `packages/extension/src/background/service-worker.ts` (SYNC_PUSH)
