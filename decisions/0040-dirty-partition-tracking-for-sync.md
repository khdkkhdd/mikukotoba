# Push 시 dirty 파티션만 동기화

Status: accepted
Date: 2026-02-20

## Context

Push가 모든 파티션(날짜별)을 순차 처리하여, 사용 기간이 길어질수록 sync가 선형적으로 느려짐. 6개월 사용 시 ~180 파티션 × API 2회(read+write) = 360회 호출. 실제 변경은 보통 1-2개 파티션뿐.

## Decision

Dirty partition tracking 도입. 단어 추가/수정/삭제 시 해당 date를 dirty set에 기록하고, push 때 dirty 파티션만 처리. Pull로 머지된 파티션도 dirty에서 제외(이미 remote와 동일하므로).

## Consequences

### Positive
- 일상적 sync: 180회 → 2회 API 호출로 감소
- 사용 기간에 관계없이 일정한 sync 속도
- 기존 merge-before-push 로직 유지 (안전성 보존)

### Negative
- dirty 상태 관리 필요 (DB 또는 로컬 메타에 저장)
- 최초 1회는 전체 push 필요 (마이그레이션)

## Alternatives Considered

- **병렬화만 적용**: Promise.all()로 동시 처리. 호출 수는 동일하므로 근본 해결 아님. 보조 수단으로는 유효하나 단독으로는 부족.
- **단일 파일 구조**: 파티션 대신 전체 단어를 하나의 파일로. 파일이 커지면 전송량 증가, 충돌 범위 확대. 기각.
- **version 비교로 skip**: remote version과 local version 같으면 skip. 로컬 변경 없이 version만 같은 경우를 정확히 판단하기 어려움. dirty tracking이 더 명확.

## References

- Plan: context.md
- Related: `packages/mobile/src/services/sync.ts`, `packages/mobile/src/services/sync-manager.ts`
