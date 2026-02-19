# FSRS card_state Drive 동기화: 단일 파일 + 디바운스 push

Status: accepted
Date: 2026-02-19

## Context

모바일 앱의 FSRS 학습 진도(card_state)가 기기 로컬에만 저장되어, 다른 기기에서 이어 학습할 수 없다. 또한 vocab push(앱→Drive)가 구현되어 있으나 호출되지 않아 양방향 동기화가 불완전하다. 단어 리뷰 시 실시간에 가까운 동기화를 원하되, Google Drive API 호출 비용을 최소화해야 한다.

## Decision

1. **단일 파일 `fsrs_state.json`**으로 모든 card_state를 Drive에 저장한다 (날짜 파티션 없음).
2. **머지 전략**: per-card `last_review` timestamp 비교 — 더 최근에 리뷰된 쪽이 이김.
3. **SyncManager 모듈**: 리뷰 후 dirty 마킹 → 30초 디바운스 → push. 앱 백그라운드 전환 시 즉시 flush. 포그라운드 복귀 시 자동 pull.
4. **vocab push 활성화**: 기존 `pushToDrive()` 함수를 SyncManager를 통해 호출.
5. **review_log는 동기화하지 않음** — card_state만으로 학습 스케줄 유지 충분.

## Consequences

### Positive
- 기기 간 학습 진도 공유 가능
- 1단어 학습 후 앱 종료해도 백그라운드 flush로 동기화 보장
- 디바운스로 연속 학습 시 API 호출 최소화 (세션당 수회)
- vocab 양방향 동기화 완성

### Negative
- 단일 파일이므로 카드 수 증가 시 파일 크기 증가 (1000카드 ≈ 100KB, 당분간 문제 없음)
- 리뷰 후 최대 30초 지연 (디바운스), 앱 강제 종료 시 유실 가능
- 네트워크 실패 시 dirty 상태 소실 (다음 리뷰에서 재동기화)

## Alternatives Considered

- **날짜 파티션 방식 (`fsrs_YYYY-MM-DD.json`)**: vocab과 동일한 패턴. 카드 리뷰 시 해당 단어의 dateAdded 파티션을 업데이트해야 해서, 리뷰 1건에 여러 파티션 파일 터치 가능. 단일 파일보다 복잡하고 API 호출이 더 많아질 수 있어 기각.
- **vocab 파티션에 card_state 포함**: 관심사 혼합. vocab 변경 없이 card_state만 바뀌어도 vocab 파일 재업로드 필요. 기각.
- **단어별 즉시 push (디바운스 없음)**: 기술적으로 API 제한 내이나, 매 리뷰마다 4 API 호출은 비효율적이고 모바일 네트워크에서 UX 저하. 기각.

## References

- Plan: distributed-forging-pebble.md
- Related: `packages/mobile/src/services/sync.ts`, `packages/shared/src/sync-core.ts`
