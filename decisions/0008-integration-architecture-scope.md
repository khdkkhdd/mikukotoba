# 통합 아키텍처 문서의 범위: 교차 관심사 중심 설계

Status: accepted
Date: 2026-02-19

## Context

5개 기술 명세(번역 공통, 단어장, 웹페이지, YouTube, Twitter)를 모두 작성하면서, 각 기능이 독립적으로 잘 동작하지만 교차 관심사(공유 모듈 조합 방식, 메시지 통신, 일본어 판별, 렌더링 모드 분기 등)에서 사이트별로 다른 접근을 취하고 있음이 드러났다. 통합 아키텍처 문서의 범위를 정해야 한다.

## Decision

`docs/tech/integration_architecture.md`는 **개별 기능을 다시 설명하지 않고**, 5개 명세를 가로지르는 교차 관심사에 집중한다.

다룰 주제:
1. **의존성 구조**: content script 진입점 → HandlerRegistry → SiteHandler → 공유 모듈 계층의 의존성 흐름
2. **공유 모듈 계층**: BatchedObserver, ProcessedTracker, HoverTooltip, RubyInjector 등의 역할 분담과 사이트별 조합 차이
3. **메시지 통신 계층**: content ↔ background ↔ popup/options 간 메시지 프로토콜 통합
4. **설정 전파 메커니즘**: 설정 변경 → 핸들러 재시작/부분 업데이트 흐름
5. **일본어 판별 전략 통합 가능성**: 3가지 전략(japaneseRatio, containsJapaneseLike, lang+CJK비율)의 통합 또는 유지 판단
6. **렌더링 모드 공통화**: hover/inline/furigana-only 3모드의 사이트별 분기를 공유 추상화할 수 있는지 평가
7. **각 명세의 개선 방향 통합**: 5개 명세에서 제안된 개선 방향을 리팩토링 우선순위로 정리

## Consequences

### Positive
- 개별 명세와 중복 없이 "전체 그림"만 다룸
- 리팩토링 시 어디서부터 시작할지 명확한 우선순위 제공
- 공유 모듈의 역할 경계가 명확해져 사이트 핸들러 간 일관성 향상 기대

### Negative
- 교차 관심사만 다루면 개별 기능의 맥락 없이는 이해가 어려울 수 있음 (5개 명세 사전 읽기 필요)
- 렌더링 모드 공통화 등 일부 주제는 실제 코드를 작성해봐야 타당성 판단 가능

## Alternatives Considered

- **전체 시스템 재설명**: 5개 명세 내용을 요약하면서 통합 관점을 추가. 중복이 과도하고, 명세 변경 시 동기화 부담이 커서 기각.
- **리팩토링 액션 아이템만 나열**: 개선 방향만 모아서 체크리스트 형태로 정리. 교차 관심사의 구조적 분석 없이 아이템만 나열하면 왜 그 순서인지 근거가 부족해 기각.
- **통합 아키텍처 생략하고 바로 리팩토링**: 5개 명세만으로 충분하다고 보고 바로 구현. 사이트 간 공유 모듈 경계가 불명확한 상태에서 리팩토링하면 일관성이 떨어질 위험이 있어 기각.

## References

- Plan: context.md
- Related: decisions/0006-tech-spec-per-feature.md
- Related: docs/tech/translation_common_tech.md, docs/tech/vocab_tech.md, docs/tech/webpage_tech.md, docs/tech/youtube_tech.md, docs/tech/twitter_tech.md
