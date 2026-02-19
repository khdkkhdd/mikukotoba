# YouTube 기능 명세를 자막/페이지 2대 기능으로 구성

Status: accepted
Date: 2026-02-19

## Context

YouTube 번역 기능 명세를 작성하면서, 자막 번역과 페이지 텍스트 번역이 설정(ON/OFF), 동작 방식, 렌더링 모두 독립적임을 확인했다. 이를 하나의 문서로 합칠지, 별도 문서로 분리할지 결정이 필요했다.

## Decision

하나의 `youtube_feature.md` 문서 안에서 **자막 번역**과 **페이지 텍스트 번역**을 2대 축으로 나란히 기술한다. 단, 두 기능의 독립성을 명확히 하기 위해 독립 제어 매트릭스(섹션 5)를 포함한다.

## Consequences

### Positive
- YouTube라는 하나의 사이트에 대한 전체 그림을 한 문서에서 파악 가능
- 두 기능 간 공유하는 맥락(SPA 네비게이션, 다크모드 대응 등)을 자연스럽게 기술
- 문서 수가 과도하게 늘어나지 않음

### Negative
- 문서 길이가 길어짐 (다른 사이트별 명세 대비)
- 자막 기능만 또는 페이지 기능만 참고하려는 경우 탐색이 필요

## Alternatives Considered

- **자막/페이지를 별도 문서로 분리**: `youtube_subtitle_feature.md` + `youtube_page_feature.md`. SPA 대응, 설정 연동 등 중복 기술이 발생하고 문서 간 참조가 복잡해져 기각.
- **공통 번역 명세에 YouTube 페이지 번역을 흡수**: 페이지 번역은 웹페이지 모드를 따르므로 공통 문서에 포함 가능. 그러나 YouTube 특유의 30여 종 요소별 동작, 설명 펼침 감지, 뷰포트 최적화 등이 분량이 커서 기각.

## References

- Plan: context.md
- Related: decisions/0001-feature-spec-before-refactoring.md, decisions/0002-common-translation-spec-scope.md, docs/youtube_feature.md
