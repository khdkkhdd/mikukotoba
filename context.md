# Goal

동기화 카운팅 정확성: pull/push 시 파티션 수나 전체 엔트리 수가 아닌, 실제 변경된 엔트리 수만 표시.

# Research

## 동기화 아키텍처

### mergeEntries 인자 순서 규칙
- `mergeEntries(A, B, tombstones)`: A가 먼저 map에, B는 timestamp이 더 클 때만 덮어씀 → **A 우선 (equal timestamp에서 A 승리)**
- Pull: `mergeEntries(remote, local, tombstones)` → remote 우선
- Push: `mergeEntries(local, remote, tombstones)` → local 우선

### 삭제 처리
- tombstone 기반: `deletedEntries[entryId] = Date.now()`
- mergeEntries에서 tombstone이 있는 엔트리는 양쪽 모두 제외
- tombstone은 Drive 메타데이터에 기록되어 양방향 전파
- 충돌 시 delete가 edit보다 우선 (tombstone이 timestamp 비교를 선행)
- TTL 30일 후 tombstone 정리

### 카운팅 (수정 완료)
- `countChangedEntries(before, after)`: 추가 + 수정(timestamp 변경) + 삭제(before에만 있는 것) 카운트
- Pull: `countChangedEntries(localEntries, merged)` — 로컬 대비 변경분
- Push: `countChangedEntries(remoteEntries, merged)` — Drive 대비 변경분

## 동기화 시나리오 검증 결과

| 시나리오 | 동기화 | 카운트 |
|----------|--------|--------|
| 추가 | 정상 | 정상 |
| 수정 | 정상 (last-write-wins) | 정상 |
| 삭제 | 정상 (tombstone 전파) | 정상 |
| 충돌: 양쪽 수정 | 최신 timestamp 승 | 정상 |
| 충돌: 삭제 vs 수정 | 삭제 승리 | 정상 |

## 관련 파일

- `packages/shared/src/sync-core.ts` — mergeEntries, countChangedEntries
- `packages/extension/src/core/drive-sync.ts` — pull, pushPartitionImmediate, pushAll
- `packages/mobile/src/services/sync.ts` — pullFromDrive, pushToDrive
- `packages/mobile/src/services/sync-manager.ts` — fullSync

# Plan

## Decisions

- countChangedEntries를 shared에 배치하여 양쪽에서 공유
- pushPartitionImmediate 반환 타입을 void → number로 변경하여 변경 엔트리 수 반환
- 삭제 카운팅: before에는 있지만 after에 없는 엔트리도 changed에 포함
- 모바일 fullSync는 여전히 allDates를 push하지만 카운트는 실제 변경분만 표시

## Steps

완료.

# Progress

- [x] `countChangedEntries` 헬퍼 추가 (shared/sync-core.ts)
- [x] 모바일 pull/push 카운팅 수정 (sync.ts)
- [x] 확장프로그램 pull/push 카운팅 수정 (drive-sync.ts, pushPartitionImmediate → number 반환)
- [x] 삭제 카운팅 추가 (before에만 있는 엔트리도 카운트)
- [x] 양쪽 빌드/타입체크 통과
