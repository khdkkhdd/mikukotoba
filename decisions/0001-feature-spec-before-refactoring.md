# Feature Specification First, Then Refactor

Status: accepted
Date: 2026-02-19

## Context

ミク言葉 프로젝트 전체 리팩토링을 앞두고, 기존 기능을 놓치지 않기 위해 현재 구현을 문서화할 필요가 있었다. 기능을 4개 영역(사전, 유튜브 번역, 트위터 번역, 일반 웹페이지 번역)으로 나누어 순차적으로 명세한다.

## Decision

리팩토링 전에 기능별로 **사용자 관점의 기능 명세서**를 `docs/` 디렉토리에 작성한다. 기술적 구현 세부사항(코드 참조, 데이터 모델, 메시지 프로토콜 등)은 포함하지 않고, "사용자가 무엇을 할 수 있는지"와 "어떻게 동작하는지"에 집중한다. 각 명세서 말미에 학습 효과 개선을 위한 To-Do도 함께 기록한다.

명세 순서:
1. `docs/dict_feature.md` - 사전(단어장) 기능 (완료)
2. `docs/youtube_feature.md` - 유튜브 번역 기능
3. `docs/twitter_feature.md` - 트위터(X) 번역 기능
4. `docs/webpage_feature.md` - 일반 웹페이지 번역 기능

## Consequences

### Positive
- 리팩토링 시 기존 기능 누락 방지 (체크리스트 역할)
- 기능 단위로 To-Do가 정리되어 리팩토링 범위 결정에 활용 가능
- 사용자 관점 명세이므로 구현 방식에 구애받지 않고 리팩토링 가능

### Negative
- 명세 작성에 시간 소요 (4개 문서)
- 코드 변경 시 문서 동기화 필요

## Alternatives Considered

- **기술 명세서 작성**: 코드 참조, 데이터 모델, 아키텍처 포함. Rejected because 리팩토링 시 구현이 바뀌므로 기술 세부사항은 금방 무의미해짐.
- **명세 없이 바로 리팩토링**: Rejected because 기능 누락 위험이 높음.

## References

- Plan: N/A
- Related: `docs/dict_feature.md`
