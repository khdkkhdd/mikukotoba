# Goal

Chrome MV3에서 service worker 종료 후 content script의 `chrome.runtime`이 무효화되는 문제를 자동 복구. 사용자가 페이지 새로고침 없이 확장 기능을 계속 사용할 수 있게 한다.

# Research

## Context Invalidation 메커니즘

- MV3 service worker는 비활성 30초 후 종료됨
- 종료 후 재시작되면 기존 content script의 `chrome.runtime`이 무효화 (`chrome.runtime.id === undefined`)
- 무효화된 content script는 메시지 송수신 불가 → 확장 기능 전체 마비
- 기존 코드에 `checkContext()` 경고만 있었고 복구 로직 없었음

## 스타일 재주입 문제

- Content script 재주입 시 `<style>` 태그가 중복 생성됨
- 3곳에서 스타일 주입: `content/index.ts` (overlay), `twitter/index.ts`, `youtube/page-handler.ts`

## 안전성 확인 사항

- 이전 인스턴스의 onMessage 리스너: context 무효화로 Chrome이 자동 제거 → 문제 없음
- 이전 인스턴스의 번역 결과: DOM에 유지. 새 핸들러가 `PROCESSED_ATTR` 확인하여 스킵
- caption-bridge.ts (MAIN world): `chrome.runtime` 미사용, window 이벤트만 → 재주입 불필요
- `tab.status !== 'complete'` 체크로 로딩 중 이중 주입 방지
- `tab.url?.startsWith('http')` + try-catch로 chrome:// 등 비주입 페이지 안전하게 스킵

# Plan

## Decisions

- **PING 메시지 방식**: content script 생존 여부를 PING-PONG으로 확인. `chrome.tabs.sendMessage` 실패 = content script 죽음
- **manifest content_scripts[0] 참조**: 재주입 시 manifest에서 js 파일 목록을 동적으로 가져옴. 하드코딩 방지
- **트리거**: `tabs.onActivated` (탭 전환) + `windows.onFocusChanged` (창 포커스 복귀). 슬립 후 복귀 커버
- **이전 UI 정리**: `cleanupPreviousInstance()`로 오버레이/팝업/모달 제거. 번역 결과는 유지 (시각적으로 유효 + PROCESSED_ATTR로 중복 방지)
- **스타일 중복 방지**: id 기반 체크 (`document.getElementById`)로 기존 style 엘리먼트 재사용

## Steps

구현 완료. 수동 테스트 남음.

# Progress

- [x] `manifest.json`: `scripting` 권한 추가
- [x] `types/index.ts`: `PING` 메시지 타입 추가
- [x] `content/index.ts`: 스타일 dedup, `cleanupPreviousInstance()`, PING 응답, 시작 시 이전 인스턴스 정리
- [x] `content/twitter/index.ts`: 스타일 dedup (`mikukotoba-twitter-styles`)
- [x] `content/youtube/page-handler.ts`: 스타일 dedup (`mikukotoba-yt-page-styles`)
- [x] `background/service-worker.ts`: `pingAndReinject` + `onActivated`/`onFocusChanged` 리스너
- [x] 빌드 통과
- [ ] 수동 테스트: 확장 리로드 → 탭 전환 → 자동 복구 확인
- [ ] 수동 테스트: 스타일 중복 없음 확인 (DOM 검사)
- [ ] 수동 테스트: 여러 탭에서 독립적 복구 확인
