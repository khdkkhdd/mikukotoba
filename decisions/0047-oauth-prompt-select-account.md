# OAuth prompt를 consent에서 select_account로 변경

Status: accepted
Date: 2026-02-20

## Context

Chrome 확장프로그램의 Google Drive 연동에서 토큰 만료 후 silent refresh(`prompt=none`, `interactive: false`)가 실패하여 사용자가 매번 재로그인해야 했다. 원인은 로그인 시 `prompt=consent`를 사용하여 매번 동의를 강제했기 때문으로, implicit flow에서 consent로 받은 토큰은 Google이 silent refresh를 허용하지 않는 경우가 있다.

## Decision

`drive-auth.ts`의 `login()` 메서드에서 `prompt` 파라미터를 `consent`에서 `select_account`로 변경. `select_account`는 계정 선택만 요구하고, 이미 동의한 scope에 대해서는 동의를 다시 요청하지 않는다. 첫 로그인이나 scope 변경 시에는 Google이 자동으로 consent 화면을 표시한다.

## Consequences

### Positive
- 토큰 만료 시 silent refresh가 안정적으로 동작
- 사용자가 매번 재로그인할 필요 없음

### Negative
- 기존 사용자는 한 번 재로그인이 필요 (새 prompt로 토큰을 받아야 함)

## Alternatives Considered

- **prompt 파라미터 제거**: Google이 필요할 때만 동의를 요청하지만, 계정 선택 없이 마지막 계정으로 자동 로그인되어 다른 계정 전환이 불가
- **consent 유지 + chrome.identity.getAuthToken 사용**: Chrome 내장 토큰 관리를 쓰면 refresh가 자동이지만, Manifest V3에서 client_id가 Chrome Web Store 등록 ID와 일치해야 하는 제약

## References

- Plan: N/A
- Related: `packages/extension/src/core/drive-auth.ts`
