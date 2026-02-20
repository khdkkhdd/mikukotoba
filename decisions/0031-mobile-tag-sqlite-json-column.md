# Mobile 태그 저장: SQLite JSON TEXT 컬럼 + LIKE 쿼리

Status: accepted
Date: 2026-02-20

## Context

Mobile에서 VocabEntry.tags를 SQLite에 저장해야 함. Junction table(vocab_tags)과 JSON TEXT 컬럼 두 방식 중 선택 필요. expo-sqlite의 JSON 함수(json_each) 지원이 불확실.

## Decision

`tags TEXT DEFAULT '[]'` 컬럼에 JSON 문자열로 저장. 쿼리는 `LIKE '%tag%'` + in-memory `entry.tags.includes(tag)` 이중 필터 패턴.

- `parseTags()`: null/undefined/파싱 실패 시 `[]` 반환
- `entryToRow()`: `JSON.stringify(e.tags ?? [])`
- LIKE로 후보군 축소 → JS에서 정확 매칭 (LIKE 부분 일치 보정)

## Consequences

### Positive
- JOIN 없이 단일 테이블 조회로 쿼리 간결
- Drive 동기화와 1:1 대응 (VocabEntry 그대로 저장/복원)
- 마이그레이션 단순 (`ALTER TABLE ADD COLUMN`)

### Negative
- 태그 기반 인덱스 불가 (full scan + in-memory 필터)
- LIKE 부분 일치로 오버매칭 발생 → JS 후처리 필수
- 태그 수정 시 전체 JSON 재직렬화

## Alternatives Considered

- **Junction table (vocab_tags)**: 정규화된 관계형 모델. Rejected because JOIN 필요, Drive 동기화와 불일치, 수천 단어 규모에서 JSON 방식 충분.
- **expo-sqlite json_each()**: SQL 레벨 정확 매칭 가능. Rejected because expo-sqlite 런타임 JSON 함수 지원 미검증, 플랫폼 의존성 위험.

## References

- Plan: context.md
- Related: decisions/0029-vocab-tag-system.md, packages/mobile/src/db/queries.ts
