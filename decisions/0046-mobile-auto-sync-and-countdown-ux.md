# 모바일 앱 자동 동기화 강화 및 학습 대기 카운트다운 실시간화

Status: accepted
Date: 2026-02-20

## Context

모바일 앱에서 cold start 시 자동 pull이 없어 다른 기기에서 추가한 단어가 반영되지 않았다. 또한 자동 동기화(포그라운드 복귀, cold start) 성공 시 마지막 동기화 시간이 갱신되지 않아 사용자가 동기화 상태를 알 수 없었다. 학습 대기 화면의 카운트다운은 렌더 시점 스냅샷이라 시간이 줄어드는 것이 보이지 않았다.

## Decision

1. **Cold start pull**: `initSyncManager`에서 AppState 리스너 등록 후 fire-and-forget으로 3종 pull 실행
2. **lastSyncTime 갱신**: 모든 자동 pull 성공 시 `useSettingsStore` + `setSyncMeta` DB 이중 업데이트. `commitSyncMeta`는 경량 pull 설계상 생략 (기존 foreground pull과 동일 패턴)
3. **실시간 카운트다운**: `useState(Date.now())` + `setInterval(1000)`으로 매초 갱신. 기존 `setTimeout` 단발 타이머 제거. 같은 콜백에서 `setNow` + `dispatch TICK`을 동시 호출하여 React 18 배치로 1회 렌더 보장

## Consequences

### Positive
- Cold start 시 최신 데이터 자동 반영
- 설정 화면에서 자동 동기화 시간도 확인 가능
- 대기 카운트다운이 매초 줄어들어 학습 재개 시점을 직관적으로 파악

### Negative
- Cold start pull은 로그인 안 된 상태에서도 시도됨 (토큰 없으면 `createSyncContextFromDb`가 null 반환하여 즉시 종료)
- 1초 간격 setInterval은 대기 화면에서만 활성화되지만 그 동안 매초 리렌더 발생

## Alternatives Considered

- **카운트다운에 기존 setTimeout 유지 + 별도 1초 display timer**: TICK과 display를 분리하면 session state와 view가 불일치하여 채점 실패 가능. 단일 interval에서 둘 다 처리하는 방식 선택
- **requestAnimationFrame 기반 카운트다운**: 초 단위 표시에 60fps는 과도. 1초 interval이 적절

## References

- Plan: context.md
- Related: `packages/mobile/src/services/sync-manager.ts`, `packages/mobile/src/study/SrsSession.tsx`
