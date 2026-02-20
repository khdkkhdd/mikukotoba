# Goal

릴레이(자유 복습) 세션에 태그 필터 추가 + SRS 세션 헤더 간소화 + 확장프로그램 기본 태그 설정.

# Research

## 릴레이 세션 필터 확장

- 기존: 날짜 범위만으로 필터링 (`getRandomEntriesByDateRange`, `getCountByDateRange`)
- 변경: 태그+날짜 복합 필터 (`RelayFilters` 인터페이스, `getRandomEntriesByFilters`, `getCountByFilters`)
- `RelayFilters.tag`: `undefined`=전체, `''`=태그없음, `'xxx'`=특정 태그
- 날짜 범위도 선택사항으로 변경 (필터 없이 전체 단어 복습 가능)

## SRS 세션 UI 간소화

- `SessionHeader` 컴포넌트 제거, 닫기 버튼(✕)을 `CountBar`에 통합
- 타이틀 텍스트 제거 → N/L/R 카운트만 표시하는 미니멀 헤더

## 확장프로그램 기본 태그

- `vocab-modal.ts`: 새 단어 추가 시 `selectedTags` 초기값 `[]` → `['community']`
- `renderTagChips()` 즉시 호출하여 UI에 반영

## 관련 파일

- `packages/mobile/src/db/queries.ts` — RelayFilters, getRandomEntriesByFilters, getCountByFilters
- `packages/mobile/src/study/RelaySession.tsx` — 필터 선택 UI (태그 칩 + 캘린더 + 프리셋)
- `packages/mobile/src/study/SrsSession.tsx` — CountBar에 닫기 버튼 통합
- `packages/mobile/app/(tabs)/vocab.tsx` — paddingBottom 미세 조정
- `packages/extension/src/content/vocab/vocab-modal.ts` — 기본 태그 community

# Plan

## Decisions

- 릴레이 phase 이름 `date-select` → `filter-select`로 변경 (날짜만이 아닌 복합 필터)
- 태그 칩은 수평 스크롤 가능한 행으로 배치 (전체 / 각 태그 / 태그 없음)
- "전체 기간" 프리셋은 startDate/endDate를 빈 문자열로 설정하여 날짜 필터 해제
- SRS 세션에서 타이틀 제거: 컨텍스트 없이도 화면 목적이 명확하므로 공간 절약 우선
- 확장프로그램 기본 태그 `community`: 커뮤니티 발견 단어가 주요 사용 사례

## Steps

- [ ] 빌드 확인 (extension + mobile)
- [ ] 실기기 테스트

# Progress

- [x] queries.ts에 RelayFilters 복합 필터 쿼리 추가
- [x] RelaySession 태그 필터 UI + 날짜 선택사항화
- [x] SrsSession 헤더 간소화 (CountBar + 닫기 통합)
- [x] Extension vocab-modal 기본 태그 community 설정
- [ ] 빌드 확인
- [ ] 실기기 테스트
