# vocab upsert를 ON CONFLICT DO UPDATE로 변경하여 CASCADE 삭제 방지

Status: accepted
Date: 2026-02-20

## Context

동기화 시 `pullFromDrive`가 vocab 항목을 `INSERT OR REPLACE`로 upsert하는데, SQLite에서 이 구문은 PK 충돌 시 DELETE → INSERT로 동작한다. `PRAGMA foreign_keys = ON` 상태에서 `card_state`와 `review_log`의 `ON DELETE CASCADE` 외래키가 트리거되어 학습기록이 전부 삭제되는 치명적 버그가 발생했다.

## Decision

`upsertEntry()`의 SQL을 `INSERT ... ON CONFLICT(id) DO UPDATE SET ...`으로 변경한다. 이 방식은 기존 행을 DELETE하지 않고 직접 UPDATE하므로 CASCADE가 발생하지 않는다.

부차적으로, 익스텐션의 `pushPartitionImmediate`에서 remote `sync_metadata.json`을 쓸 때 `fsrsPartitionVersions`/`reviewPartitionVersions`를 보존하도록 수정한다.

## Consequences

### Positive
- 동기화 시 card_state, review_log가 보존됨
- vocab 테이블의 실제 DELETE(단어 삭제)에서는 CASCADE가 정상 동작

### Negative
- UPDATE SET 절에 모든 컬럼을 나열해야 하므로 스키마 변경 시 쿼리도 함께 수정 필요

## Alternatives Considered

- **PRAGMA foreign_keys = OFF**: 근본적으로 FK를 비활성화. 삭제 시 고아 레코드가 남을 수 있어 거부.
- **upsert 전에 기존 card_state를 백업 후 복원**: 복잡하고 트랜잭션 내에서 race condition 가능성. 거부.
- **DELETE CASCADE 제거 후 수동 삭제 관리**: 삭제 로직이 분산되어 유지보수 부담 증가. 거부.

## References

- Plan: context.md
- Related: `packages/mobile/src/db/queries.ts`, `packages/mobile/src/db/schema.ts`, `packages/extension/src/core/drive-sync.ts`
