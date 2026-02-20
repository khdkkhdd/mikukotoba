# 앱 재시작 시 Google 세션 자동 복원 (signInSilently)

Status: accepted
Date: 2026-02-20

## Context

앱을 완전히 종료 후 재시작하면 Google Drive 연동이 해제되었다. `GoogleSignin.getCurrentUser()`가 인메모리 캐시만 확인하는 동기 메서드라 cold restart 시 항상 `null`을 반환했기 때문이다.

## Decision

`restoreAuthState()`에서 `hasPreviousSignIn()` 확인 후 `signInSilently()`를 호출하여 키체인에서 이전 세션을 복원한다. 함수를 async로 변경하고, `_layout.tsx`에서 DB 초기화 전에 await하여 인증 상태가 먼저 복원되도록 한다.

## Consequences

### Positive
- 앱 재시작 후에도 Google Drive 연동이 유지됨
- DB 초기화 전 인증 복원이 완료되어 SyncManager가 올바른 상태로 시작

### Negative
- `signInSilently()` 네트워크 호출로 앱 초기 로딩이 약간 느려질 수 있음 (토큰 갱신 필요 시)

## Alternatives Considered

- **AsyncStorage에 토큰 직접 저장**: 토큰 만료/갱신 로직을 직접 관리해야 해서 복잡. Google SDK가 이미 키체인 관리를 제공.
- **앱 시작 시 매번 signIn() 호출**: 사용자에게 로그인 UI가 매번 보임. signInSilently()는 UI 없이 백그라운드 복원.

## References

- Plan: N/A
- Related: `packages/mobile/src/services/drive-auth.ts`, `packages/mobile/app/_layout.tsx`
