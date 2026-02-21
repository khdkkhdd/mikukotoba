# YouTube 셀렉터 누락 보완 및 링크 내부 클릭 이벤트 수정

Status: accepted
Date: 2025-02-22

## Context

YouTube 페이지 핸들러의 `YT_SELECTOR_DEFS`가 일부 UI 컴포넌트를 커버하지 못해 후리가나가 표시되지 않았다. 또한 `<a>` 태그 내부에 삽입된 furigana 블록의 ruby 클릭 시 `preventDefault()` 누락으로 페이지 이동이 발생했다.

## Decision

1. **셀렉터 추가**: 재생목록 사이드 패널(`ytd-playlist-panel-video-renderer #video-title`), 채널 홈 영상 제목(`ytd-grid-video-renderer #video-title`) 셀렉터를 `YT_SELECTOR_DEFS`에 추가.
2. **클릭 이벤트**: `furigana-block.ts`의 `attachWordClickHandlers`에 `e.preventDefault()` 추가하여 `<a>` 내부 ruby 클릭 시 네비게이션 차단.
3. **hover 밑줄 제거**: `.jp-yt-hover-target`의 `text-decoration: underline dotted` 제거하여 Twitter와 일관된 스타일 유지.
4. **채널 헤더 이름 제외**: 새 리디자인(`yt-dynamic-text-view-model`)의 채널명은 고정 높이 레이아웃 깨짐 + 고유명사 특성상 셀렉터에 포함하지 않음.

## Consequences

### Positive
- 재생목록 사이드 패널(25개 항목), 채널 홈 영상 제목이 후리가나 처리 대상에 포함
- ruby 클릭이 단어 조회로 정상 동작, 의도치 않은 페이지 이동 방지
- YouTube/Twitter 간 hover 스타일 일관성 확보

### Negative
- 채널 헤더 이름은 후리가나 미지원 (레이아웃 제약)
- YouTube가 컴포넌트를 변경하면 셀렉터 추가 보수 필요

## Alternatives Considered

- **채널 헤더에 셀렉터 추가**: `yt-dynamic-text-view-model h1 span.yt-core-attributed-string` 시도했으나, 고정 높이 헤더에서 furigana 블록이 영역을 확장해 아래 컴포넌트 잘림. 고유명사라 학습 효과도 낮아 제외.
- **`stopPropagation()`만으로 해결**: `<a>` 태그의 기본 동작은 `stopPropagation()`으로 막을 수 없음. `preventDefault()`가 필수.

## References

- Plan: context.md
- Related: `packages/extension/src/content/youtube/utils.ts`, `packages/extension/src/content/shared/renderers/furigana-block.ts`, `packages/extension/src/content/youtube/youtube-page.css`
