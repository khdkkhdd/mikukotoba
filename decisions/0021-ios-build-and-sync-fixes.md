# iOS 로컬 빌드 설정 및 동기화 버그 수정

Status: accepted
Date: 2026-02-19

## Context

모바일 앱을 실제 iOS 기기/시뮬레이터에서 실행하기 위해 로컬 빌드를 시도했다. 빌드 과정에서 React 버전 충돌, Push Notifications 제한, Xcode 26.2 호환 문제가 발생했고, 실행 후 Extension↔Drive↔Mobile 동기화가 작동하지 않는 버그를 발견했다.

## Decision

### 빌드 환경

- 루트 `package.json`에 `overrides: { "react": "19.1.0" }`으로 React 버전 강제 통일 (react-native 0.81.5의 renderer가 19.1.0 요구)
- `MikuKotoba.entitlements`에서 `aps-environment` 제거 (무료 Apple 계정은 Push Notifications 미지원)
- Expo CLI `--device` 대신 Xcode 직접 빌드 또는 `npx expo run:ios` 시뮬레이터 사용 (Xcode 26.2 devicectl 호환 문제)

### 동기화 버그 수정

- **Extension `pull()`**: `localVersion === 0 && remoteVersion === 0`일 때 로컬 데이터가 있으면 push하도록 분기 추가. Drive 연동 전에 추가한 단어가 동기화되지 않는 버그 해결.
- **Mobile pull/push 카운트**: 파티션(날짜) 단위 → 엔트리(단어) 단위로 변경. `pulled++` → `pulled += merged.length`.
- **Mobile `flush()` 내 `dirtyVocabDates.clear()`**: push 호출 전 → 성공 후로 이동. 네트워크 실패 시 dirty 상태가 소실되어 재시도가 불가능한 버그 해결.

### Google Sign-In 설정

- iOS OAuth Client ID를 같은 GCP 프로젝트(582194695290)에서 생성하여 appDataFolder 공유
- Info.plist에 `GIDClientID` + reversed client ID URL scheme 추가
- `_layout.tsx`에서 앱 초기화 시 `configureDriveAuth()` 호출

## Consequences

### Positive
- Extension과 Mobile이 같은 Drive appDataFolder를 통해 양방향 동기화 정상 작동
- 기존 Extension 단어가 Mobile로 pull되는 것 확인 (13개 엔트리)
- 동기화 결과 알림이 정확한 엔트리 수를 표시
- push 실패 시 dirty 상태가 보존되어 다음 기회에 재시도 가능

### Negative
- 무료 Apple 계정: 7일마다 재서명 필요, Push Notifications 사용 불가
- Expo CLI의 물리 기기 직접 설치(`--device`)가 Xcode 26.2에서 미작동 — Xcode 직접 빌드 필요
- React 버전을 19.1.0으로 고정 — Expo SDK 업그레이드 시 재확인 필요

## Alternatives Considered

- **EAS Build (클라우드)**: Expo 클라우드 빌드 서비스. 유료 플랜 필요하고 로컬 디버깅이 불편하여 기각.
- **React 19.2.4 사용**: npm workspaces에서 자동 호이스팅된 버전. react-native-renderer 19.1.0과 불일치하여 런타임 에러 발생, 기각.
- **Extension에서 "push all" 버튼 추가**: 기존 단어 동기화를 위해 별도 UI 추가. pull() 내 자동 감지로 해결하여 불필요.

## References

- Plan: context.md
- Related: decisions/0020-fsrs-drive-sync-single-file.md, decisions/0017-monorepo-npm-workspaces.md
- Files: packages/extension/src/core/drive-sync.ts, packages/mobile/src/services/sync.ts, packages/mobile/src/services/sync-manager.ts
