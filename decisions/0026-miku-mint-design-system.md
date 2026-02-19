# 미쿠 민트 디자인 시스템으로 전환

Status: accepted
Date: 2026-02-20

## Context

프로젝트 이름이 ミク言葉(미쿠 코토바)인데 디자인이 테라코타/베이지 따뜻한 톤이라 미쿠와 연관성이 없었다. 미쿠를 연상시키는 민트 중심 컬러로 전환하되, 시각적 조화와 가독성을 최우선으로 한다.

## Decision

따뜻한 테라코타/베이지 컬러 시스템을 미쿠 민트 중심의 쿨톤으로 전면 교체한다.

### 컬러 매핑

| 역할 | 이전 (따뜻한) | 이후 (미쿠) |
|------|-------------|------------|
| accent | `#C96B4F` | `#39C5BB` |
| accent hover | `#B85A40` | `#2EADA3` |
| accentLight | `rgba(201,107,79,0.12)` | `rgba(57,197,187,0.10)` |
| bg | `#F5F2EE` | `#F2F7F7` |
| popup bg | `#FAF8F5` | `#F7FAFA` |
| text | `#2D2A26` | `#2D3436` |
| textSecondary | `#5C5650` | `#5A6570` |
| textMuted | `#9C958E` | `#8E9AA4` |
| textPlaceholder | `#BFB8B0` | `#B4BFC8` |
| border | `#E8E4DF` | `#DEE6EA` |
| borderLight | `#F0EDE8` | `#EBF0F2` |
| success | `#5B8A72` | `#3EA87E` |
| shadow | `rgba(120,100,80,...)` | `rgba(60,100,110,...)` |
| scrollbar | `#D0CBC4` | `#B8C8CE` |

### 버튼 전략

미쿠 민트(`#39C5BB`)는 흰 글씨 대비 2.13:1로 WCAG AA 미달. 따라서 버튼은 민트 배경 + 다크 틸 텍스트(`#0D4F52`, 대비 5.96:1) 전략을 사용한다.

## Consequences

### Positive
- 프로젝트 정체성과 비주얼이 일치
- WCAG AA 접근성 유지 (버튼 대비 5.96:1)
- 쿨톤 뉴트럴이 민트 액센트와 자연스럽게 조화

### Negative
- 기존 따뜻한 톤에 익숙한 사용자는 적응 필요
- 밝은 민트 버튼 + 어두운 텍스트는 흰 텍스트 버튼보다 시각적 임팩트가 약할 수 있음

## Alternatives Considered

- **딥 틸(`#137A7F`) 버튼 + 흰 글씨**: 접근성은 좋으나 미쿠 느낌이 안 남. 너무 어두움.
- **핑크 보조 액센트**: 미쿠 캐릭터에 핑크 요소가 있지만, 유저가 민트 단일 톤을 선호.

## References

- Plan: N/A
- Related: `packages/mobile/src/components/theme.ts`, 모든 CSS 파일
