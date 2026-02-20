# Content Script CSS를 inline 문자열로 주입

Status: accepted
Date: 2026-02-20

## Context

CRXJS Vite 플러그인이 content script의 CSS import를 별도 청크 파일(`/assets/index-*.css`)로 추출한다. Content script 로더가 이 CSS를 preload할 때 URL이 호스트 페이지 origin으로 해석되어 (`https://x.com/assets/index-*.css`) 로드 실패: `Unable to preload CSS for /assets/index-*.css`.

## Decision

모든 content script CSS import를 Vite의 `?inline` 쿼리로 변경하여 CSS를 문자열로 번들에 포함시키고, `document.createElement('style')`로 직접 주입한다.

```typescript
import styles from './file.css?inline';
const el = document.createElement('style');
el.textContent = styles;
(document.head || document.documentElement).appendChild(el);
```

적용 대상: `overlay-styles.css`, `twitter.css`, `youtube-page.css`. `*.css?inline` 모듈 선언은 `src/types/vite.d.ts`에 추가.

## Consequences

### Positive
- CSS preload 에러 완전 해소: 빌드 산출물에 content script용 CSS 청크 없음
- 외부 파일 의존 제거: CSS가 JS 번들에 포함되어 로드 타이밍 문제 없음
- popup/options/vocabulary 페이지는 정상 HTML이므로 기존 CSS import 유지

### Negative
- JS 번들 크기 미세 증가 (~4KB CSS가 JS에 포함)
- CSS 캐싱 분리 불가 (CSS만 변경 시 JS도 재다운로드) — content script 규모에서 무시 가능

## Alternatives Considered

- **`chrome.runtime.getURL()` 동적 로드**: CSS URL을 `chrome-extension://` 절대 경로로 변환하여 `<link>` 삽입. CRXJS 로더 수정 필요, 빌드 파이프라인 침투적.
- **`vite:preloadError` 이벤트 무시**: `window.addEventListener('vite:preloadError', e => e.preventDefault())`. 에러 숨길 뿐 CSS 실제 적용 안 됨.
- **Vite config에서 CSS code split 비활성화**: `build.cssCodeSplit: false`. 전체 빌드에 영향, popup/options 페이지 CSS도 인라인됨.

## References

- Plan: N/A
- Related: `packages/extension/src/content/index.ts`, `packages/extension/src/content/twitter/index.ts`, `packages/extension/src/content/youtube/page-handler.ts`, `packages/extension/src/types/vite.d.ts`
