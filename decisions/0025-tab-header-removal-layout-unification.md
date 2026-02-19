# 탭 헤더 제거 및 레이아웃 통일

Status: accepted
Date: 2026-02-20

## Context

expo-router Tabs의 기본 네비게이션 헤더가 화면 상단 공간을 많이 차지하면서 하단 탭 바와 역할이 중복됨. 헤더 제거 후 각 탭 화면의 paddingTop, 타이틀 크기가 제각각이어서 일관성이 부족했음.

## Decision

- `_layout.tsx`에서 `headerShown: false`로 탭 네비게이션 헤더 제거
- 모든 탭 화면: `paddingTop: 80`, 타이틀 `fontSize.xxl (28)`, `fontWeight: '700'`, 좌측 정렬로 통일
- 단어장 SectionList sticky header: `backgroundColor: colors.bg` + `paddingTop` (margin 대신) 사용

## Consequences

### Positive
- 콘텐츠 영역 확대 (헤더 높이만큼)
- 탭 간 시각적 일관성 확보
- sticky header 투명 이슈 해결

### Negative
- 각 화면이 자체적으로 safe area padding을 관리해야 함

## Alternatives Considered

- **헤더 유지 + 높이 축소**: 여전히 탭 바와 역할 중복. 거부.
- **SafeAreaView로 paddingTop 자동 계산**: 플랫폼별 차이 발생 가능, 현재 iOS 전용이므로 고정값이 더 단순. 거부.

## References

- Plan: context.md
- Related: `packages/mobile/app/(tabs)/_layout.tsx`, 각 탭 화면 파일
