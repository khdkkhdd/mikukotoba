# Gemini API: 번역 작업에서 thinking 비활성화

Status: accepted
Date: 2026-02-20

## Context

Gemini 2.5 Flash는 thinking이 기본 활성화되어 있어, 번역 시 `maxOutputTokens: 4096` 예산을 thinking 토큰이 대부분 소비했다. 실제 번역 출력이 162토큰에서 잘리는(`MAX_TOKENS`) 문제가 발생했다.

## Decision

모델별로 thinking을 비활성화/최소화하는 `getThinkingConfig()` 메서드를 도입한다:
- `gemini-2.5-*`: `thinkingBudget: 0` (완전 비활성화)
- `gemini-3-*`: `thinkingLevel: "low"` (최소화, 완전 비활성화 불가)
- 기타 모델: thinking 설정 없음

## Consequences

### Positive
- 번역 truncation 문제 해결 — 출력 토큰 전량을 번역에 사용
- 응답 속도 향상 — thinking 단계 생략
- API 비용 절감 — 불필요한 토큰 생성 제거

### Negative
- 극히 복잡한 문학적 번역에서 미세한 품질 저하 가능성 (실사용 체감 없음)

## Alternatives Considered

- **thinkingBudget을 줄이되 0은 아닌 값 (예: 128)**: 약간의 thinking 허용. 번역에 thinking이 품질 개선 효과가 없어 불필요한 비용.
- **maxOutputTokens 증가 (예: 8192)**: thinking 토큰 소비를 감안해 예산 확대. 근본 원인(불필요한 thinking) 해결 없이 비용만 증가.
- **thinkingLevel: "minimal" 일괄 적용**: 2.5 모델에서는 `thinkingLevel` 미지원. 모델별 분기 필요.

## References

- Plan: N/A
- Related: `packages/extension/src/core/translator/gemini.ts`
- Docs: https://ai.google.dev/gemini-api/docs/thinking
