# 기능별 기술 명세를 docs/tech/에 개별 작성

Status: accepted
Date: 2026-02-19

## Context

기능 명세(feature spec) 5건이 완료되어 리팩토링 전 단계가 마무리되었다. 이제 실제 구현을 위한 기술 명세가 필요한데, 기존 구현을 그대로 따르는 것이 아니라 각 기능을 더 정교하고 견고하게 만들기 위한 기술적 설계 문서가 요구된다.

## Decision

`docs/tech/` 디렉토리에 기능별 기술 명세를 개별 파일로 작성한다.

- `translation_common_tech.md` — 번역 파이프라인 공통 (엔진, 캐시, 용어집, 형태소 분석, 프롬프트)
- `vocab_tech.md` — 단어장 (스토리지, 자동 분석, 모달, 퀴즈, 검색, 내보내기)
- `youtube_tech.md` — YouTube 전용 (자막 추출/표시, 페이지 텍스트, SPA/Polymer 대응)
- `twitter_tech.md` — Twitter 전용 (트윗/유저/트렌드, 가상 스크롤, React 대응)
- `webpage_tech.md` — 일반 웹페이지 (일본어 감지, 3모드, 범용 Observer)
- `integration_architecture.md` — 위 5건을 기반으로 한 전체 통합 아키텍처

작성 순서: 공통 번역 → 단어장 → 웹페이지 → YouTube → Twitter → 통합 아키텍처.
각 문서는 현재 구현 분석을 기반으로 하되, 기존 로직에 얽매이지 않고 개선된 설계를 목표로 한다.

## Consequences

### Positive
- 기능별로 독립된 기술 문서가 있어 담당자가 해당 영역만 참조 가능
- 공통 → 개별 → 통합 순서로 의존성 방향에 맞춰 점진적으로 설계 확정
- 기존 구현의 edge case 대응과 workaround를 명시적으로 문서화하여 리팩토링 시 누락 방지

### Negative
- 6개 문서 간 중복 서술이 발생할 수 있음 (공통 번역과 사이트 핸들러 경계)
- 문서 작성에 상당한 시간이 소요됨

## Alternatives Considered

- **단일 통합 기술 문서**: 하나의 큰 문서에 모든 기능을 기술. 문서가 너무 방대해지고 영역별 독립 작업이 어려워 기각.
- **기존 plan 문서 확장**: `youtube-translation-plan.md`, `twitter-translation-plan.md` 등 기존 기술 문서를 확장. 기존 문서는 현재 구현 기준이라 "개선된 설계"라는 목표와 맞지 않아 기각.
- **코드 주석으로 대체**: 기술 명세 없이 코드에 직접 주석으로 설계 의도를 기록. 전체 그림을 파악하기 어렵고 구현 전 설계 검토가 불가능하여 기각.

## References

- Plan: context.md
- Related: decisions/0001-feature-spec-before-refactoring.md
- Related: docs/architecture-refactoring-plan.md
