# Goal

YouTube 자막 오버레이가 자막이 없거나 꺼진 상황에서도 계속 표시되는 버그 수정.
자막 없음 / 자막 사이 빈 구간 / CC 끄기 시 오버레이가 즉시 사라져야 한다.

# Research

## SubtitleExtractor 3가지 추출 방식과 `onClear()` 호출 현황 (수정 전)

| 방식 | 트리거 | `onClear()` 호출 | 파일 위치 |
|------|--------|-----------------|-----------|
| TextTrack | `cuechange` 이벤트 | `activeCues.length === 0`일 때 호출 | subtitle-extractor.ts:257-263 |
| TimedText | `timeupdate` 이벤트 | 현재 시간이 자막 구간 밖이면 호출 | subtitle-extractor.ts:506-508 |
| DOM capture | MutationObserver | **미호출** (segments.length === 0이면 그냥 return) | subtitle-extractor.ts:528-549 |

## TextTrack 모드 변경 문제

유저가 YouTube CC를 끄면 TextTrack mode가 `hidden` → `disabled`로 변경됨.
`cuechange` 이벤트는 모드 변경 시 발생하지 않음 → 마지막 자막이 계속 표시.
`video.textTracks`의 `change` 이벤트로 모드 변경 감지 가능.

## 오버레이 show/hide 흐름

- `SubtitleOverlay.show(result)`: opacity 1 + innerHTML 렌더링
- `SubtitleOverlay.hide()`: opacity 0 + 200ms 후 innerHTML 클리어
- `SubtitleHandler` 생성자에서 `onClear: () => subtitleOverlay.hide()` 전달

## 파일 참조

- `packages/extension/src/content/youtube/subtitle-extractor.ts` — 자막 추출 (3가지 방식)
- `packages/extension/src/content/youtube/subtitle-overlay.ts` — 오버레이 DOM/Shadow DOM 관리
- `packages/extension/src/content/youtube/subtitle-handler.ts` — 핸들러 오케스트레이션

# Plan

## Decisions

- **DOM 캡처에 `onClear()` 추가**: `segments.length === 0`일 때 `lastDisplayedText` 클리어 + `onClear()` 호출
- **TextTrack 모드 변경 감지**: `video.textTracks`의 `change` 이벤트 리스너 추가, `disabled` 상태 감지 시 `onClear()` 호출
- **주기적 폴링 미채택**: 이벤트 기반으로 충분하므로 불필요한 setInterval 회피

## Steps

- [x] DOM 캡처: `segments.length === 0`일 때 `onClear()` 호출 추가
- [x] TextTrack: `startTrackModeWatcher()` / `stopTrackModeWatcher()` 메서드 추가
- [x] `stop()`에서 `stopTrackModeWatcher()` 정리 추가
- [x] 빌드 확인 통과

# Progress

모든 수정 완료. `npm run build` 통과.
Decision: `decisions/0057-subtitle-overlay-hide-fix.md`

# Others

YouTube 자막 켤 때 표시되는 안내 문구("설정을 확인하려면 클릭하세요" 등)가 자막으로 잡히는 별도 이슈 있음. 추후 필터링 필요할 수 있으나 현재 스코프에서 제외.
