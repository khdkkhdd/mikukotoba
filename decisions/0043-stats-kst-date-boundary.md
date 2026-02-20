# 통계 날짜 기준을 KST 자정으로 변경

Status: accepted
Date: 2026-02-20

## Context

통계 히트맵, 스트릭, 일별 집계 등 모든 날짜 기준이 UTC 자정(한국 시간 오전 9시)이었다. `reviewed_at`이 ISO UTC 문자열로 저장되고, SQLite `DATE()`와 JS `toISOString().slice(0,10)` 모두 UTC 기준으로 동작했기 때문이다. 한국 사용자가 자정 이후 학습한 기록이 전날로 집계되었다.

## Decision

- SQL: `DATE(reviewed_at)` → `DATE(reviewed_at, '+9 hours')` (KST 변환)
- JS: `toISOString().slice(0,10)` → 로컬 Date 메서드 (`getFullYear/Month/Date`) 기반 `localDateStr()` 헬퍼
- `getTodayNewCardCount`: UTC 자정 대신 로컬 자정(`setHours(0,0,0,0)`)의 ISO 변환값 사용

KST +9시간을 하드코딩한다.

## Consequences

### Positive
- 한국 시간 자정 기준으로 날짜가 넘어가 사용자 기대와 일치
- 스트릭, 히트맵, 일일 신규 카드 한도 모두 일관된 기준 적용

### Negative
- KST `+9 hours` 하드코딩으로 다른 타임존 사용자에게는 부정확 (현재 한국 전용 앱이므로 문제 없음)

## Alternatives Considered

- **디바이스 타임존 오프셋 동적 계산**: SQL에 파라미터로 전달해야 해서 쿼리가 복잡해짐. 여행 시 타임존 변경되면 과거 데이터 집계가 달라질 수 있음.
- **reviewed_at을 로컬 시간으로 저장**: Drive 동기화 시 다른 기기와 시간 비교가 어려워짐. UTC 저장 + 표시 시 변환이 표준.

## References

- Plan: N/A
- Related: `packages/mobile/src/db/queries.ts`
