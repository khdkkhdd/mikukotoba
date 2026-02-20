# 단어장 리스트 여백/간격 개선

Status: accepted
Date: 2026-02-20

## Context

모바일 단어장 화면에서 태그 필터 행의 텍스트 아래 빈 공간, 검색창과 날짜 헤더 사이 과도한 간격, 섹션 헤더 보더가 화면 끝까지 뻗는 문제가 있었다.

## Decision

`packages/mobile/app/(tabs)/vocab.tsx` 스타일 3건 수정:

1. **태그 필터 행 수직 정렬**: `tagRowContent`에 `alignItems: 'center'` 추가. `tagRow.maxHeight: 40` 유지하면서 칩을 수직 중앙에 배치.
2. **검색창-헤더 간격 축소**: `searchInput.marginBottom`을 `spacing.md`(16) → `spacing.sm`(8)로 변경.
3. **섹션 헤더 보더 범위 축소**: `sectionHeader`에서 `marginHorizontal: -spacing.lg`와 `paddingHorizontal: spacing.lg` 제거. 보더가 리스트 콘텐츠 영역 내에서만 표시.

## Consequences

### Positive
- 태그 칩이 행 내에서 정중앙 배치되어 균형감 향상
- 검색창과 첫 섹션 사이 불필요한 여백 제거
- 보더가 콘텐츠 폭에 맞춰 더 깔끔한 시각적 구분

### Negative
- 섹션 헤더가 이전보다 덜 눈에 띔 (보더 폭 축소)

## Alternatives Considered

- **tagRow maxHeight 축소**: 34px로 줄여봤으나 콘텐츠가 잘릴 위험. `alignItems: 'center'`가 더 안전.
- **sectionHeader paddingTop 축소**: 16→8px로 줄여봤으나 헤더 자체가 답답해져서 검색창 marginBottom 축소로 전환.

## References

- Plan: context.md
- Related: `packages/mobile/src/components/theme.ts` (spacing/fontSize 정의)
