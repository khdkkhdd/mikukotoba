# YouTube 자막 오버레이 미숨김 버그 수정

Status: accepted
Date: 2026-02-22

## Context

YouTube 자막 오버레이가 자막이 없거나, 자막 사이 빈 구간이거나, 유저가 CC를 끌 때에도 계속 표시되는 버그.
SubtitleExtractor의 3가지 추출 방식(TextTrack / TimedText / DOM) 중 DOM과 TextTrack에서 오버레이 숨김 처리가 누락되어 있었다.

## Decision

두 가지 수정 적용:

1. **DOM 캡처 방식에 `onClear()` 호출 추가**: `segments.length === 0`일 때 `return`만 하던 것을 `onClear()` 호출로 변경하여 오버레이 숨김 처리.

2. **TextTrack 모드 변경 감지 추가**: `video.textTracks`의 `change` 이벤트를 감지하여, 일본어 트랙이 `disabled`로 변경되면(유저가 CC 끄기) `onClear()` 호출. `cuechange` 이벤트는 모드 변경 시 발생하지 않기 때문에 별도 감지 필요.

## Consequences

### Positive
- 3가지 추출 방식 모두에서 자막 없을 때 오버레이가 올바르게 숨겨짐
- 유저가 CC를 끄면 즉시 오버레이 제거

### Negative
- `change` 이벤트 리스너 하나 추가 (성능 영향 미미)

## Alternatives Considered

- **주기적 폴링으로 오버레이 상태 확인**: setInterval로 자막 존재 여부를 주기적 확인. 불필요한 연산 발생하므로 이벤트 기반 접근 선택.

## References

- Plan: N/A
- Related: `packages/extension/src/content/youtube/subtitle-extractor.ts`
