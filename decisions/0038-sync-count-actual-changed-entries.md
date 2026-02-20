# 동기화 카운트를 실제 변경된 엔트리 수로 수정

Status: accepted
Date: 2026-02-20

## Context

모바일 fullSync가 전체 날짜를 push하면서 `pushed += entries.length`로 파티션 내 모든 엔트리를 합산해, push 카운트가 항상 전체 단어 수와 동일하게 표시됐다. 확장프로그램은 반대로 파티션 개수만 카운트(`pushed++`)하여 의미 없는 숫자를 보여줬다.

## Decision

shared에 `countChangedEntries(before, after)` 헬퍼를 추가하여 양쪽에서 실제 변경된 엔트리만 카운트한다.

- merge 전후 배열을 비교: 추가(새 ID) + 수정(timestamp 변경) + 삭제(before에만 존재) 세 가지 모두 카운트
- Pull: `countChangedEntries(localEntries, merged)` — 로컬 관점 변경분
- Push: `countChangedEntries(remoteEntries, merged)` — Drive 관점 변경분
- 확장프로그램 `pushPartitionImmediate` 반환 타입을 `void` → `number`로 변경

## Consequences

### Positive
- 사용자에게 실제 의미 있는 숫자 표시
- 변경 없으면 0으로 표시되어 "이미 최신 상태" 판단 가능
- 모바일/확장프로그램 동일한 카운팅 로직 공유

### Negative
- push 시 remote 데이터를 이미 읽으므로 추가 비용 없지만, countChangedEntries 자체가 O(n) 순회 추가
- fullSync는 여전히 전체 날짜를 push (카운트만 정확해졌을 뿐 불필요한 API 호출은 그대로)

## Alternatives Considered

- **카운터만 수정 (변경된 파티션 수 표시)**: 파티션 수는 사용자에게 의미 없음. 거부.
- **변경된 파티션만 push**: 카운트 문제는 해결되지만 merge-before-push의 안전성을 포기해야 함. 별도 최적화로 분리.
- **mergeEntries 자체가 변경 수 반환**: 함수 시그니처 변경이 크고, pull/push에서 비교 기준(before)이 다름. 외부 헬퍼가 더 유연.

## References

- Plan: context.md
- Related: `packages/shared/src/sync-core.ts`, `packages/mobile/src/services/sync.ts`, `packages/extension/src/core/drive-sync.ts`
