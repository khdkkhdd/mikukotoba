# 단어장 태그 분류 시스템

Status: accepted
Date: 2026-02-20

## Context

단어장의 단어가 날짜 기반으로만 분류되어, "JLPT N4", "음식" 등 사용자 정의 카테고리로 분류하고 필터링할 수 없었다. 태그는 선택사항이며, 기존 단어와 기본 동작에 영향을 주지 않아야 했다.

## Decision

VocabEntry에 `tags: string[]` 필드를 추가하고, 읽기 시 `entry.tags ?? []` 폴백으로 하위 호환성 보장. 태그 목록은 별도 저장 없이 엔트리에서 실시간 추출 (drift 방지). 최근 태그만 `jp_vocab_recent_tags` 키로 캐시하여 모달 로드 속도 확보. 동기화는 기존 entry-level LWW 그대로 활용 (태그 편집 시 timestamp 갱신).

## Consequences

### Positive
- 마이그레이션 불필요: 기존 데이터는 read/write 사이클에서 자연스럽게 `tags: []` 포함
- Drive 동기화 변경 없음: `mergeEntries()` LWW가 tags 필드 자동 포함
- 단어장 페이지에서 날짜별/태그별 뷰 전환, 태그 필터링, 태그별 drill-down 지원
- 단어 추가 모달에서 태그 입력 + 기존 태그 autocomplete

### Negative
- 동시 태그 편집 시 entry-level LWW로 한쪽 변경 유실 가능 (충돌 빈도 극히 낮음)
- Mobile SQLite는 JSON 텍스트 컬럼 사용 → 태그 기반 쿼리에 in-memory 필터 필요

## Alternatives Considered

- **별도 tags 테이블/저장소**: Junction table이나 별도 키로 태그 관리. 동기화 복잡도 증가, Drive 파일 포맷 변경 필요. 규모상 과도.
- **태그별 timestamp 분리**: `tagsModified` 필드로 태그 변경만 추적. 머지 로직 복잡화 대비 이점 미미.
- **별도 태그 마스터 목록 저장**: 태그 목록을 별도 키로 유지. 엔트리와 drift 발생 위험, 동기화 대상 추가.

## References

- Plan: silly-gathering-knuth.md
- Related: `packages/shared/src/types.ts`, `packages/extension/src/core/vocab-storage.ts`, `packages/extension/src/vocabulary/vocabulary.ts`
