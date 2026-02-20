# Goal

동기화 시 학습기록(FSRS card_state, review_log) 손실 버그 수정.
크롬 익스텐션에서 단어 추가 후 모바일 앱에서 sync하면 기존 학습기록이 전부 삭제되는 문제.

# Research

## 근본 원인: INSERT OR REPLACE + ON DELETE CASCADE

- `schema.ts`: `PRAGMA foreign_keys = ON` 활성화 상태
- `card_state.vocab_id REFERENCES vocab(id) ON DELETE CASCADE` — vocab 삭제 시 card_state 연쇄 삭제
- `review_log.vocab_id REFERENCES vocab(id) ON DELETE CASCADE` — 동일하게 review_log도 연쇄 삭제
- `queries.ts:upsertEntry()`: `INSERT OR REPLACE INTO vocab` 사용
- SQLite의 `INSERT OR REPLACE`는 PK 충돌 시 **DELETE → INSERT** 순서로 동작
- DELETE 단계에서 CASCADE 트리거 → card_state, review_log 행 삭제
- 이후 vocab 행은 재삽입되지만 학습기록은 이미 소실

## 발생 경로

`pullFromDrive` → `mergeEntries` (기존+새 항목 합침) → `upsertEntries` → 기존 vocab을 동일 id로 re-insert → CASCADE 삭제

## 부차 버그: 익스텐션 메타데이터 덮어쓰기

- `extension/drive-sync.ts:pushPartitionImmediate()`: remote `sync_metadata.json` 읽을 때 `fsrsPartitionVersions`/`reviewPartitionVersions` 필드를 읽지 않고, 새 메타 작성 시 이 필드를 제외하여 Drive에서 삭제됨
- 모바일이 이전에 push한 FSRS/리뷰 버전 정보가 소실될 수 있음

# Plan

## Decisions

- `INSERT OR REPLACE` → `INSERT ... ON CONFLICT(id) DO UPDATE SET ...` 변경: 진짜 UPSERT로 DELETE를 트리거하지 않아 CASCADE 미발생
- 익스텐션 `pushPartitionImmediate`에서 remote meta 읽을 때 FSRS/리뷰 버전도 읽어서 보존

## Steps

완료.

# Progress

- [x] 원인 분석: `INSERT OR REPLACE` + `ON DELETE CASCADE` 조합 확인
- [x] `queries.ts:upsertEntry()` 수정: `ON CONFLICT(id) DO UPDATE SET` 방식으로 변경
- [x] `extension/drive-sync.ts:pushPartitionImmediate()` 수정: `fsrsPartitionVersions`/`reviewPartitionVersions` 보존
- [x] 빌드 검증: extension build + mobile tsc --noEmit 통과
- [ ] 커밋
- [ ] decision writing
