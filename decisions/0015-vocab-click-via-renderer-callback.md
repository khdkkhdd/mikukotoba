# 렌더러 콜백으로 단어 클릭→단어장 연동

Status: accepted
Date: 2026-02-19

## Context

후리가나/인라인 번역에 표시된 단어를 클릭하여 단어장에 추가하는 기능이 필요했다. 렌더러(`createRubyClone`, `createInlineBlock`)는 모든 핸들러(Twitter, YouTube, Webpage)가 공유하므로, 한 곳에서 수정하면 전체에 적용되어야 했다.

## Decision

렌더러 옵션에 `onWordClick?: WordClickCallback` 콜백을 추가하고, 실제 콜백은 `word-click-callback.ts`에서 dynamic import로 제공한다.

- `ruby-injector.ts`: `<ruby>` 요소 생성 시 클릭 이벤트 바인딩
- `inline-block.ts`: furigana div 내 `<ruby>` 요소에 클릭 이벤트 바인딩
- `word-click-callback.ts`: 단일 콜백 → lazy `vocab-click-handler.ts` → `showVocabModal()`
- 각 핸들러에서 `onWordClick` 옵션을 전달 (import 1줄 추가만으로 적용)

## Consequences

### Positive
- 모든 핸들러에 동일 동작 보장 (콜백 하나)
- 초기 번들에 vocab 모듈 미포함 (dynamic import로 클릭 시에만 로드)
- 기존 링크/멘션 클릭과 충돌 없음 (`closest('a')` 체크 + `stopPropagation`)

### Negative
- 렌더러 옵션 객체가 점점 커짐 (6~7개 옵션)
- 첫 클릭 시 dynamic import 지연 (~100ms)

## Alternatives Considered

- **이벤트 위임 (delegated event on body)**: `document.body`에 ruby 클릭을 위임. 장점은 렌더러 수정 불필요. 거부 이유: Shadow DOM 내부의 이벤트가 body까지 전파되지 않을 수 있고, 어떤 토큰이 클릭됐는지 surface/reading 정보를 DOM에서 역추출해야 하는 복잡성.
- **MutationObserver로 후처리**: 렌더러가 생성한 ruby에 후처리로 이벤트 부착. 거부 이유: Observer 오버헤드 + 타이밍 이슈 (렌더 직후 observe 보장 어려움).

## References

- Plan: `context.md`
- Related: `src/content/shared/renderers/ruby-injector.ts`, `src/content/shared/renderers/inline-block.ts`, `src/content/vocab/word-click-callback.ts`
