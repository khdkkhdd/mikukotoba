# mergeEntries pull 방향 수정 + 익스텐션 merge-before-push

Status: accepted
Date: 2026-02-20

## Context

0035에서 모바일 pushToDrive에 merge-before-push를 적용했으나 태그 동기화 문제가 지속됨. 추가 분석 결과 두 가지 문제 발견: (1) 익스텐션 pushPartitionImmediate에도 동일한 merge-before-push 누락, (2) `mergeEntries`의 인자 순서가 pull/push 양쪽에서 동일하여 pull 시 remote 데이터가 local에 패배.

## Decision

### 1. 익스텐션 pushPartitionImmediate에 merge-before-push 추가

모바일과 동일 패턴: Drive 기존 데이터를 읽어 `mergeEntries`로 머지 후 push. 머지 결과를 로컬에도 저장.

### 2. pull 시 mergeEntries 인자 순서 반전

`mergeEntries(first, second)` — first가 map에 먼저, second는 `timestamp >` 일 때만 교체. equal timestamp에서 first 승리.

- **push (merge-before-push)**: `mergeEntries(local, remote)` — local 우선 (내가 push하는 데이터가 기본)
- **pull**: `mergeEntries(remote, local)` — remote 우선 (Drive에서 가져온 데이터가 기본)

양쪽(익스텐션/모바일) pull 함수에 적용.

## Consequences

### Positive
- pull 시 Drive의 최신 데이터가 로컬의 오래된 데이터를 덮어씀 (태그 등 필드 업데이트 반영)
- push 시 로컬 의도를 보존하면서 remote-only 데이터도 병합
- 익스텐션/모바일 양쪽 push에서 상대방 데이터 소실 방지

### Negative
- pull 시 로컬의 미push 변경이 같은 timestamp이면 remote에 패배 (드문 케이스: push 전 서비스워커 종료 등)
- push당 API 호출 증가 (익스텐션도 파티션별 1회 read 추가)

## Alternatives Considered

- **mergeEntries에 `preferRemote` 파라미터 추가**: 명시적이지만 호출부마다 판단 필요. 인자 순서가 더 간결하고 기존 API 변경 없음.
- **`>` → `>=`로 변경 (remote가 항상 교체)**: push에서도 remote가 이기게 되어 push의 의미가 퇴색.
- **timestamp 갱신 강제**: 장기적으로 올바르나 기존 데이터 문제를 해결하지 못함.

## References

- Plan: context.md
- Supersedes: 0035-drive-sync-merge-before-push.md (확장)
- Related: `packages/shared/src/sync-core.ts`, `packages/extension/src/core/drive-sync.ts`, `packages/mobile/src/services/sync.ts`
