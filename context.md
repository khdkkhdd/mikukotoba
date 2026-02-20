# Goal

모바일 단어장(vocab) 화면 UI 여백/간격 개선. 태그 필터 행, 검색창-헤더 간격, 섹션 헤더 보더 등 시각적 밀도 조정.

# Research

파일: `packages/mobile/app/(tabs)/vocab.tsx`
테마: `packages/mobile/src/components/theme.ts` — spacing.xs=4, sm=8, md=16, lg=24

현재 변경 내역:
- `tagRowContent`: `alignItems: 'center'` 추가 → 태그 칩 수직 중앙 정렬 (tagRow maxHeight: 40 유지)
- `searchInput.marginBottom`: spacing.md(16) → spacing.sm(8) → 검색창-헤더 간격 축소
- `sectionHeader`: `marginHorizontal: -spacing.lg` + `paddingHorizontal: spacing.lg` 제거 → 보더가 콘텐츠 영역 안에서만 표시

# Progress

- [x] 태그 필터 행 수직 중앙 정렬
- [x] 검색창 ↔ 섹션 헤더 간격 축소
- [x] 섹션 헤더 보더 좌우 끝 제거
- [ ] 실기기에서 최종 확인
