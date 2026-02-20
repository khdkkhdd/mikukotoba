# 릴레이 복합 필터 도입 + SRS 세션 헤더 간소화

Status: accepted
Date: 2026-02-20

## Context

릴레이(자유 복습) 세션은 날짜 범위로만 단어를 필터링할 수 있었다. 태그 시스템(0029, 0031)이 도입된 후 태그별 복습 수요가 생겼고, 날짜 범위가 항상 필수여서 "전체 단어 복습"이 불편했다. SRS 세션은 타이틀 헤더가 공간을 차지하면서 카드 영역을 줄이고 있었다.

## Decision

1. **릴레이 복합 필터**: `RelayFilters` 인터페이스(태그+날짜)로 확장. 태그와 날짜 범위 모두 선택사항으로 변경하여 필터 없이 전체 단어 복습 가능.
2. **SRS 헤더 간소화**: `SessionHeader` 컴포넌트 제거, 닫기 버튼(✕)을 `CountBar`에 통합. 타이틀 텍스트 삭제.
3. **Extension 기본 태그**: 새 단어 추가 시 `community` 태그 자동 선택.

## Consequences

### Positive
- 태그별 집중 복습 가능 (예: community 태그만 모아서 복습)
- 날짜 범위 없이도 전체 복습 시작 가능 → UX 단순화
- SRS 세션 카드 영역 확대, 시각적 노이즈 감소
- 릴레이 세션 헤더에 선택된 태그 표시 → 현재 필터 컨텍스트 확인 가능

### Negative
- `getCountByFilters`의 태그 필터링이 LIKE + in-memory 필터 조합 (JSON 컬럼 한계, 0031 결정과 동일 트레이드오프)
- Extension 기본 태그가 하드코딩됨 (설정으로 빼지 않음)

## Alternatives Considered

- **태그 전용 별도 화면**: 날짜 선택과 분리된 태그 필터 화면. 두 필터를 조합할 수 없어 기각.
- **SRS 타이틀 축소만**: 타이틀 폰트 줄이기. 여전히 공간을 차지하고, 화면 목적이 이미 명확하므로 완전 제거 선택.

## References

- Plan: context.md
- Related: decisions/0029-vocab-tag-system.md, decisions/0031-mobile-tag-sqlite-json-column.md
- Files: `packages/mobile/src/db/queries.ts`, `packages/mobile/src/study/RelaySession.tsx`, `packages/mobile/src/study/SrsSession.tsx`
