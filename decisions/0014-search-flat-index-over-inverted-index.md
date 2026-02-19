# 단어장 검색: 플랫 인덱스 선택 (역인덱스 대신)

Status: accepted
Date: 2026-02-19

## Context

`VocabStorage.search()`가 모든 날짜 파티션을 순회하며 전체 필드를 검색하는 O(N) 전수 검색이었다. 단어 수가 수백 개를 넘으면 체감 지연이 예상되어 개선이 필요했다.

## Decision

`jp_vocab_search_flat` 키에 검색 필드만 포함한 경량 배열을 유지한다.

- `SearchEntry`: `{ id, date, word, reading, romaji, meaning, note }`
- 검색 시: 플랫 배열 1회 로드 → 매칭 ID 추출 → 해당 날짜 파티션만 로드
- CRUD 시: 플랫 인덱스 동기 갱신 (add/update/delete)
- `rebuildSearchIndex()`: 기존 데이터 마이그레이션용 (onInstalled에서 호출)

## Consequences

### Positive
- 검색 시 storage 접근 횟수: N+1 → 1+M (M=매칭 날짜 수, 대부분 ≪ N)
- 구현 단순 (배열 filter, ~20줄)
- 1000개 항목 기준 ~100KB, 단일 `chrome.storage.local.get`으로 충분

### Negative
- 추가 저장 공간 소모 (항목 수 × ~100B)
- CRUD마다 플랫 인덱스도 갱신 필요 (추가 1회 write)

## Alternatives Considered

- **역인덱스 (inverted index)**: 토큰별 → ID 목록 매핑. 검색 정밀도 높음. 거부 이유: CRUD 시 토큰 분리·인덱스 갱신 복잡성이 높고, 부분 일치 검색에는 오히려 불리.
- **전수 검색 유지**: 현재 상태 유지. 거부 이유: 항목 증가 시 모든 날짜 파티션 로드로 인한 성능 저하 불가피.

## References

- Plan: `context.md`
- Related: `src/core/vocab-storage.ts`, `docs/tech/vocab_tech.md` 2.2절
