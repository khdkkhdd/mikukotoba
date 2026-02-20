# FSRS/리뷰 로그 월별 파티션 동기화

Status: accepted
Date: 2026-02-20

## Context

단어장(vocab)은 날짜별 파티션으로 변경분만 push/pull하지만, FSRS 카드 상태(`fsrs_state.json`)와 리뷰 로그(`review_logs.json`)는 단일 파일로 전체를 매번 업로드/다운로드한다. 데이터가 쌓일수록 비효율적이고 네트워크 비용이 증가한다.

## Decision

FSRS와 리뷰 로그를 **월별(YYYY-MM) 파티션**으로 분리한다.

- FSRS: vocab의 `dateAdded` 월 기준 → `fsrs_YYYY-MM.json`
- 리뷰 로그: `reviewed_at` 월 기준 → `reviews_YYYY-MM.json`
- `DriveSyncMeta`에 `fsrsPartitionVersions`, `reviewPartitionVersions` 추가 (optional, 하위호환)
- dirty 추적: `dirtyFsrsVocabIds: Set<string>` (vocabId → 월 변환), `dirtyReviewMonths: Set<string>`
- 레거시 마이그레이션: pull 시 양쪽 partitionVersions가 비어있고 레거시 파일 존재하면 자동 수행 + 파티션 파일 push까지 완료
- remote meta 읽기 최적화: `fetchRemoteMeta()`로 1회 읽어서 3개 pull 함수에 공유

## Consequences

### Positive
- 변경 월만 push/pull → API 호출 수 O(전체 월) → O(변경 월)
- 리뷰 로그는 현재 월만 append되므로 대부분 1개 파티션만 전송
- vocab 파티션과 자연스럽게 정렬되어 일관된 구조

### Negative
- `sync_metadata.json`에 3종류 버전 맵이 공존 → `pushToDrive`(vocab)가 meta 쓸 때 FSRS/리뷰 필드 carry-over 필요
- 레거시 마이그레이션이 pull 함수 안에서 push도 수행하는 예외적 흐름

## Alternatives Considered

- **vocabId 해시 기반 파티션**: 고른 분포 가능하나 직관성 부족, 특정 기간 데이터만 동기화 불가. Rejected.
- **단일 파일 유지 + 압축**: gzip으로 전송량 줄이기. 근본 해결이 아니고 전체 파일 read/write는 여전. Rejected.
- **FSRS도 reviewed_at 기준**: 한 카드를 여러 번 복습하면 여러 파티션에 걸쳐 최신 상태 추적이 복잡. `dateAdded` 기준이면 카드 1개 = 파티션 1개로 깔끔. Rejected.

## References

- Plan: context.md
- Related: `packages/shared/src/sync-core.ts`, `packages/mobile/src/services/sync.ts`, `packages/mobile/src/services/sync-manager.ts`
