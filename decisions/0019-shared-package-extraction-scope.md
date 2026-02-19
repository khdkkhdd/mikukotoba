# shared 패키지 추출 범위: 순수 함수와 타입만

Status: accepted
Date: 2026-02-19

## Context

모노레포 전환 시 extension과 mobile이 공유할 코드의 범위를 결정해야 했다. Drive 동기화 관련 코드 중 일부는 Chrome storage API에 의존하고, 일부는 순수 fetch/로직이었다.

## Decision

shared에는 플랫폼 의존성 없는 코드만 추출:
- **타입**: VocabEntry, SyncMetadata, DrivePartitionContent 등
- **Drive API**: 순수 fetch 기반 REST 호출 (DriveAPI 객체)
- **sync-core**: mergeEntries, cleanTombstones, drivePartitionName — 순수 함수

Chrome storage 어댑터(getLocalMeta, saveLocalEntries 등), 인증(DriveAuth — chrome.identity 사용), debounce 로직은 extension에 유지.

## Consequences

### Positive
- shared 패키지에 플랫폼 의존성 제로 — 어디서든 import 가능
- extension의 기존 코드 변경 최소화 (import 경로만 변경)
- 동기화 핵심 로직(머지, tombstone 정리)이 단일 소스로 관리됨

### Negative
- extension의 drive-sync.ts와 mobile의 sync.ts에 유사한 orchestration 코드 존재 (pull/push 흐름)
- DriveAuth는 플랫폼별 구현이 완전히 다르므로 공유 불가

## Alternatives Considered

- **전체 동기화 엔진 추상화**: storage adapter 인터페이스를 정의하고 shared에 전체 sync 엔진 배치. 추상화 비용 대비 두 플랫폼만 있어 과도, 기각.
- **DriveAPI만 추출 (sync-core 제외)**: mergeEntries가 핵심 비즈니스 로직이고 양쪽에서 동일하게 사용하므로 반드시 공유해야 함, 기각.

## References

- Plan: context.md
- Related: `packages/shared/src/sync-core.ts`, `packages/extension/src/core/drive-sync.ts`, `packages/mobile/src/services/sync.ts`
