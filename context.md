# Goal

트위터 팔로우 추천 페이지(`/i/connect_people`)와 사이드바 팔로우 추천 영역에서 후리가나 및 번역이 정상 동작하도록 수정. 추가로, @멘션이 포함된 바이오의 ruby clone에서 줄바꿈이 발생하는 레이아웃 버그 해결.

# Research

## UserCell DOM 구조 (팔로우 추천)

### 추천 페이지 (`/i/connect_people`)
- `<button data-testid="UserCell">` 안에 이름, 핸들, 팔로우 버튼, 바이오 포함
- 소셜 컨텍스트("XX님이 팔로우합니다")가 있는 셀은 추가 래퍼 div 존재
- 바이오: `<div dir="auto" style="overflow: hidden">` — 깊이가 유동적 (`:scope > div > div`로 도달 불가)
- 이름/핸들: `dir="ltr"` 사용, 숨겨진 aria 설명: `display:none` (빈 innerText)

### 사이드바 팔로우 추천
- `<li data-testid="UserCell">` (페이지와 다르게 `<li>` 사용)
- 바이오 텍스트 없음 — 이름 + 핸들 + 팔로우 버튼만 표시
- 이름만 후리가나/호버 대상

## 기존 코드 문제점

1. **바이오 셀렉터 미스매치**: `:scope > div > div`가 실제 DOM 깊이와 불일치
2. **링크 필터 오탐**: 바이오 div에 `a[role="link"]`(@멘션)가 포함되어 통째로 스킵
3. **소셜 컨텍스트 오탐**: "ウオン님이 팔로우합니다"의 카타카나가 일본어로 감지 → break로 바이오 미처리
4. **이름 후리가나 미지원**: hover target만 등록, `processHoverWithFurigana` 미호출
5. **바이오 hover+furigana 미지원**: hover 모드에서 furigana 없이 hover target만 등록

## @멘션 래퍼 줄바꿈 (미해결)

- 트위터 @멘션은 `<div class="css-175oi2r r-xoduu5"><span><a>` 구조
- `createRubyClone`이 `innerHTML`을 복사하면 래퍼 div가 block으로 렌더링 → 줄바꿈 발생
- 시도 1: `getComputedStyle`로 원본 display 복사 → 실패
- 시도 2: 클론 내 모든 div에 `display: inline` 강제 → 실패
- 원인 미확정. 실제 DOM에서 직접 디버깅 필요

# Plan

## Decisions

- 바이오 셀렉터: `div[dir="auto"]` 사용 — DOM 깊이 무관, dir 속성으로 바이오/이름/aria 구분
- 이름 후리가나: `showFurigana` 시 `processHoverWithFurigana()` 호출 (hover+furigana 동시 동작)
- 바이오 hover+furigana: `processUserDescription`과 동일 패턴 적용
- @멘션 줄바꿈: 되돌림. 브라우저에서 직접 디버깅 후 재시도 필요

## Steps

- [x] 바이오 셀렉터 수정 (`:scope > div > div` → `div[dir="auto"]`)
- [x] 바이오 hover 모드에서 `processHoverWithFurigana` 호출
- [x] 이름에 `processHoverWithFurigana` 적용
- [ ] @멘션 래퍼 줄바꿈 디버깅 및 수정 (보류)
- [ ] 커밋

# Progress

## 완료

- `user-handler.ts`: `processUserCell` 바이오 셀렉터 + 이름/바이오 후리가나 처리 수정
- 빌드 통과

## 보류

- `ruby-injector.ts` @멘션 div 줄바꿈 — 두 차례 시도 실패, 변경 되돌림. 브라우저 직접 디버깅 필요

## 변경 파일

- `packages/extension/src/content/twitter/user-handler.ts`
