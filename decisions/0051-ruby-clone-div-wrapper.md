# Ruby Clone: div 래퍼로 커스텀 엘리먼트 렌더링 문제 해결

Status: accepted
Date: 2026-02-22

## Context

호버모드에서 YouTube 커뮤니티 게시글 텍스트가 사라지는 버그 발생. 원인은 두 가지였다:
1. `getInsertionAnchor`의 커뮤니티 게시글 특별 케이스가 hover 모드에서 clone을 collapsed expander 안에 삽입
2. `createRubyClone`이 `yt-formatted-string` 커스텀 엘리먼트를 `cloneNode`하면 Polymer 라이프사이클이 실행되지 않아 자식 노드가 렌더링되지 않음 (`offsetHeight: 0`, `display: none`)

## Decision

`createRubyClone`에서 `element.cloneNode(true)` 대신 `document.createElement('div')` + `innerHTML` 복사 방식으로 변경. 원본 엘리먼트의 computed style(fontSize, lineHeight, color, whiteSpace, letterSpacing, wordBreak)을 인라인 스타일로 복사.

추가로 `getInsertionAnchor`의 커뮤니티 게시글 케이스에 `webpageMode !== 'hover'` 조건을 추가하여, hover 모드에서는 clone이 expander 바깥에 삽입되도록 함.

## Consequences

### Positive
- 커뮤니티 게시글이 hover 모드에서 정상 표시됨 (Playwright 테스트로 검증)
- YouTube의 모든 `yt-formatted-string` 기반 요소(댓글, 설명 등)에서 동일 문제 예방
- Polymer/Lit 커스텀 엘리먼트에 의존하지 않아 YouTube UI 업데이트에 더 견고

### Negative
- `div` 래퍼가 원본 태그의 CSS 규칙(태그 기반 셀렉터)을 상속받지 못함 — computed style 복사로 보완
- 원본 엘리먼트의 커스텀 엘리먼트 속성/메서드에 접근 불가 (현재 사용하지 않으므로 무관)

## Alternatives Considered

- **cloneNode + display 인라인 스타일 강제**: display:block 설정해도 커스텀 엘리먼트 내부 렌더링이 안 되어 offsetHeight: 0. 근본 해결 불가.
- **hover 모드에서 clone 생략 (원본 직접 사용)**: 후리가나 주입이 불가능하고, 원본 DOM 수정 시 정리가 복잡.
- **원본 텍스트 노드에 직접 ruby 주입**: DOM 정리(cleanup) 시 원본 복원이 어렵고, YouTube의 Polymer 바인딩과 충돌 가능.

## References

- Related: `packages/extension/src/content/shared/renderers/ruby-injector.ts`, `packages/extension/src/content/youtube/page-handler.ts`
