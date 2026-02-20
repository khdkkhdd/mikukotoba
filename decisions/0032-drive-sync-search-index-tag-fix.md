# Extension 검색 인덱스 태그 누락 수정: drive-sync vs vocab-storage 이중 rebuildSearchIndex

Status: accepted
Date: 2026-02-20

## Context

Extension에 `rebuildSearchIndex()` 함수가 두 곳에 존재: `vocab-storage.ts`(CRUD 시 사용)와 `drive-sync.ts`(sync 후 호출). `vocab-storage.ts`는 `toSearchEntry()`로 tags 포함하지만, `drive-sync.ts`는 인라인 객체 리터럴로 tags를 빠뜨림. sync할 때마다 검색 인덱스에서 태그가 사라지는 버그.

## Decision

`drive-sync.ts:rebuildSearchIndex()` 인라인 타입에 `tags: string[]` 추가, 객체 리터럴에 `tags: e.tags ?? []` 추가.

근본 원인(코드 중복)은 이번에 수정하지 않음 — `vocab-storage.ts`의 `rebuildSearchIndex()`와 통합하면 모듈 간 의존성 변경 필요하여 범위 초과.

## Consequences

### Positive
- sync 후에도 태그 검색/필터 정상 동작
- 최소 변경으로 버그 수정 (타입 + 1줄 추가)

### Negative
- 두 곳의 rebuildSearchIndex가 여전히 중복 존재 (향후 통합 과제)

## Alternatives Considered

- **drive-sync에서 VocabStorage.rebuildSearchIndex() 호출**: 코드 중복 제거 가능. Rejected because drive-sync → vocab-storage 의존성 추가가 아키텍처 변경이며, 태그 기능 범위를 넘김.
- **SearchEntry 타입을 shared로 추출**: 양쪽에서 import. Rejected because 현재 SearchEntry는 extension 내부 개념이라 shared에 두기 부적절.

## References

- Plan: context.md
- Related: packages/extension/src/core/drive-sync.ts:64-85, packages/extension/src/core/vocab-storage.ts:278-292
