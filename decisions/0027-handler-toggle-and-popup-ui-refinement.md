# 핸들러별 독립 토글 + 팝업 UI 개선

Status: accepted
Date: 2026-02-20

## Context

확장 프로그램의 4개 핸들러(Twitter, YouTube 자막, YouTube 페이지, 일반 웹페이지)를 각각 독립적으로 on/off 할 수 없었다. Twitter는 항상 활성화, YouTube 페이지 번역은 webpageMode에 종속되어 있었다. 이와 함께 팝업의 라디오 버튼 UI와 키보드 단축키도 개선이 필요했다.

## Decision

### 핸들러별 토글
- `HandlerEnabledMap` 타입으로 4개 핸들러 활성 상태를 독립 관리
- 기존 `siteSettings?` 필드를 `handlerEnabled: HandlerEnabledMap`으로 교체
- 각 핸들러의 `isEnabled()`에서 `handlerEnabled` 참조 + `?? true` fallback으로 하위 호환
- `SETTINGS_CHANGED`에서 handlerEnabled 변경 감지 시 `cleanupAll()` + `init()` 재시작

### 팝업 UI
- 웹페이지 모드: 라디오 버튼 → 세그먼트 컨트롤 (민트 배경 + 흰색 텍스트)
- 체크박스: 기본 브라우저 → 커스텀 스타일 (민트 배경 + 흰색 체크마크, grid 센터링)
- 토글 행: padding 추가로 여백 확보
- 웹페이지 모드에서 `off` 옵션 제거 (핸들러 토글이 대체)

### 키보드 단축키
- `Alt+J` → `Alt+M` (ミク — 더 직관적)
- `cycle-webpage-mode` 명령 추가 (기본 키 미지정)
- 설정 페이지에서 플랫폼 감지로 Mac(`⌥`) / Windows(`Alt`) 키 표기 자동 전환

## Consequences

### Positive
- 사용자가 사이트별로 번역을 세밀하게 제어 가능
- 팝업 UI가 민트 디자인 시스템과 통일
- 세그먼트 컨트롤로 모드 선택이 시각적으로 명확
- Mac 사용자에게도 올바른 키 표기 제공

### Negative
- 기존 `youtubeMode` 필드를 하위 호환용으로 유지해야 함
- Chrome 확장 제한으로 suggested_key는 4개까지만 가능, cycle-webpage-mode는 수동 설정 필요

## Alternatives Considered

- **커스텀 라디오 버튼**: 기존 레이아웃 유지하며 원 크기만 키우는 방안. 세그먼트 컨트롤이 더 컴팩트하고 모던하여 기각.
- **드롭다운 셀렉트**: 가장 컴팩트하지만 한눈에 옵션을 볼 수 없어 기각.

## References

- Related: `packages/extension/src/types/index.ts`, `packages/extension/src/popup/`
