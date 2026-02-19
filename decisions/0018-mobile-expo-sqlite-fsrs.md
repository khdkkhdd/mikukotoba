# Expo + SQLite + ts-fsrs 모바일 앱 스택

Status: accepted
Date: 2026-02-19

## Context

iOS에서 단어장 학습 앱을 구현해야 했다. 오프라인 우선 동작, 간격 반복 학습(SRS), Google Drive 동기화가 핵심 요구사항이었다. 기존 확장이 TypeScript 기반이므로 타입 공유가 가능한 스택이 유리했다.

## Decision

- **프레임워크**: Expo (dev build) + expo-router — 파일 기반 라우팅, OTA 업데이트
- **로컬 DB**: expo-sqlite — 오프라인 우선, 빠른 쿼리, 관계형 스키마
- **SRS**: ts-fsrs — FSRS-5 알고리즘의 검증된 TypeScript 구현체
- **상태 관리**: Zustand — 경량, TypeScript 친화
- **Google 인증**: @react-native-google-signin — drive.appdata scope 지원

FSRS 학습 데이터(card_state, review_log)는 앱 로컬 전용. Drive에 동기화하지 않음.

## Consequences

### Positive
- TypeScript 공유로 VocabEntry 타입 불일치 방지
- SQLite로 복잡한 쿼리 가능 (due 카드 조회, 날짜별 그룹 등)
- FSRS는 Anki의 최신 알고리즘 — 학술적으로 검증됨
- Zustand는 보일러플레이트 최소, React hooks와 자연스러운 통합

### Negative
- expo-sqlite는 dev client 필요 (Expo Go 미지원)
- @react-native-google-signin도 네이티브 빌드 필요
- FSRS 데이터가 기기별이므로 기기 교체 시 학습 진도 유실

## Alternatives Considered

- **AsyncStorage**: 키-값 스토어라 관계형 쿼리 불가. SRS 스케줄링에 부적합, 기각.
- **WatermelonDB**: SQLite 위 ORM이지만 추가 추상화 계층 불필요, 기각.
- **SM-2 (SuperMemo 2)**: Anki 구 알고리즘. FSRS 대비 학습 효율 입증 논문 있어 FSRS 선택.
- **FSRS 데이터 Drive 동기화**: 충돌 해결 복잡도 높고, 학습 진도는 기기별이 자연스러워 로컬 전용으로 결정.

## References

- Plan: context.md
- Related: `packages/mobile/src/fsrs/index.ts`, `packages/mobile/src/db/schema.ts`
