# 학습 탭 태그별 학습: 모든 태그 항상 표시

Status: accepted
Date: 2026-02-20

## Context

학습 탭 하단의 "태그별 학습" 섹션이 due 카드가 있는 태그만 표시했다. 태그를 달아도 한 번도 학습하지 않았거나 복습 시점이 안 된 태그는 보이지 않아, 사용자 입장에서 태그가 있는데 왜 안 나오는지 혼란스러운 상태였다.

## Decision

모든 태그를 항상 표시하도록 변경. `getDueCountByTag`(due만 카운트)를 `getStudyCountsByTag`(due + new 카운트)로 교체하고, `count > 0` 필터를 제거했다.

- 카운트 표시: `복습 N + 새 M` / 둘 다 0이면 `학습 완료`
- 정렬: (due + new) 합계 내림차순
- 태그 클릭 시 해당 태그의 due + new 카드만으로 SRS 세션 시작

## Consequences

### Positive
- 태그가 있으면 항상 보이므로 직관적
- 새 단어도 카운트에 포함되어 학습 현황을 더 정확히 반영
- 태그별 집중 학습 진입점이 명확해짐

### Negative
- 태그가 많아지면 학습 탭 스크롤이 길어질 수 있음

## Alternatives Considered

- **태그별 학습 섹션 자체를 삭제**: "오늘의 학습"이 이미 전체를 커버하므로 중복이라는 판단. 기획적으로 태그별 집중 학습 기능을 유지하기로 결정하여 기각.
- **due 카드 있는 태그만 표시 (기존)**: 태그를 달았는데 안 보이는 혼란 발생. 기각.

## References

- Plan: context.md
- Related: `packages/mobile/src/db/queries.ts` (getStudyCountsByTag), `packages/mobile/app/(tabs)/study.tsx`
