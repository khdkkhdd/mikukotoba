# 단어장 검색 최적화에 경량 플랫 배열 방식 채택

Status: accepted
Date: 2026-02-19

## Context

현재 단어장 검색은 모든 날짜 파티션을 로드하여 메모리에서 전수 필터링한다. 단어 수가 수백 개를 넘으면 `chrome.storage.local.get`이 모든 파티션을 읽어야 하므로 성능 저하가 우려된다. 날짜 기반 파티셔닝의 장점(추가/삭제 효율)을 유지하면서 검색을 개선할 방안이 필요했다.

## Decision

검색 전용 경량 플랫 배열(`jp_vocab_search_flat`)을 별도로 유지한다. 이 배열에는 각 항목의 검색 가능 필드(id, date, word, reading, romaji, meaning)만 포함하며, 검색 시 이 단일 키만 로드하여 필터링 후 매칭된 항목의 전체 데이터는 해당 날짜 파티션에서 로드한다.

## Consequences

### Positive
- 검색 시 스토리지 접근이 1회(플랫 배열) + 매칭 날짜 파티션 수로 감소
- 1000개 항목 기준 ~100KB 이내로 단일 `get` 호출로 충분
- 기존 날짜 기반 파티셔닝 구조를 변경할 필요 없음

### Negative
- 항목 추가/삭제/수정 시 플랫 배열도 함께 갱신해야 하는 이중 쓰기 비용
- 플랫 배열과 날짜 파티션 간 데이터 불일치 가능성 (비정상 종료 시)

## Alternatives Considered

- **역인덱스(Inverted Index)**: 단어/읽기/뜻의 토큰을 키로 하는 역인덱스 구축. 검색은 빠르지만, 부분 일치 검색이 어렵고 인덱스 유지 비용이 높아 기각.
- **전수 검색 유지**: 현재 방식 그대로 유지. 단어 수가 적을 때는 문제없으나, 확장성이 부족하여 기각.
- **IndexedDB 전환**: 브라우저 내장 DB로 전환하면 인덱싱과 쿼리를 네이티브로 처리 가능. 그러나 Chrome Extension의 Service Worker에서 IndexedDB 접근이 불안정하고, 기존 chrome.storage 기반 코드 전체를 재작성해야 하므로 기각.

## References

- Plan: docs/tech/vocab_tech.md (섹션 2.2)
- Related: src/core/vocab-storage.ts
