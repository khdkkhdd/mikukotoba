# review_log Drive 동기화 — append-only merge-before-push

Status: accepted
Date: 2026-02-20

## Context

학습 통계(연속 학습일, 정확도, 히트맵 등)가 로컬 review_log 테이블에서만 계산되어 기기 간 공유 불가. review_log를 Drive 동기화에 추가하여 통계를 기기 간 통합해야 함.

## Decision

- `review_logs.json` 단일 파일로 Drive 동기화
- **merge-before-push** 패턴: push 전에 리모트를 먼저 읽어 합집합 머지 후 업로드
- 머지 키: `vocab_id|reviewed_at` 복합 키로 Set 기반 중복 제거, 시간순 정렬
- FSRS push/pull과 동일 시점에 수행 (sync-manager의 flush/pull/fullSync에 통합)
- `replaceAllReviewLogs()`에서 FK 존재 확인으로 삭제된 vocab의 로그 유입 방지

## Consequences

### Positive
- 기기 간 학습 통계 통합 (스트릭, 정확도, 히트맵)
- 기존 sync-manager 타이밍 재사용 — 추가 트리거 불필요
- append-only 데이터 특성상 충돌 없이 합집합으로 안전하게 머지

### Negative
- 단일 파일이므로 장기 사용 시 파일 크기 증가 (연 ~1.2MB, 당분간 문제 없음)
- merge-before-push는 push마다 리모트 파일을 한 번 더 읽어야 함

## Alternatives Considered

- **FSRS와 동일한 단순 덮어쓰기**: append-only 데이터에서는 다른 기기 데이터가 소실됨. 거부.
- **파티션 분할 (월별 파일)**: 행당 ~65B로 크기가 작아 파티션 복잡도 대비 이점 없음. 거부.
- **별도 sync 트리거**: review_log는 항상 FSRS 변경과 동시에 발생하므로 불필요. 거부.

## References

- Plan: context.md
- Related: `packages/shared/src/sync-core.ts` (mergeReviewLogs), `packages/mobile/src/services/sync.ts` (pushReviewLogs, pullReviewLogs)
