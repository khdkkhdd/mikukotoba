# npm workspaces 모노레포 전환

Status: accepted
Date: 2026-02-19

## Context

Chrome 확장에 저장된 단어장 데이터를 iOS에서 학습할 수 있는 React Native 앱이 필요했다. 확장과 앱이 VocabEntry 타입, Drive API, 동기화 로직을 공유해야 하므로 단일 레포에서 코드를 참조할 수 있는 구조가 필요했다.

## Decision

npm workspaces로 모노레포 전환. `packages/shared`, `packages/extension`, `packages/mobile` 3개 패키지.

shared에는 순수 함수/타입만 추출 (VocabEntry, DriveAPI, mergeEntries, cleanTombstones). Chrome storage 의존 코드는 extension에 유지.

## Consequences

### Positive
- 타입 정의 단일 소스 — 확장/앱 간 VocabEntry 불일치 방지
- Drive API/동기화 로직 중복 제거
- 추가 도구 설치 없이 npm 내장 기능만 사용

### Negative
- extension의 tsconfig에서 rootDir 제거 필요 (noEmit이므로 실질적 문제 없음)
- vite.config.ts에 shared alias 수동 설정 필요
- extension types/index.ts에서 shared 타입을 import+re-export해야 로컬 스코프 접근 가능 (export type만으로는 같은 파일 내 사용 불가)

## Alternatives Considered

- **Turborepo**: 빌드 캐싱, 병렬 실행 이점. 두 패키지만 있고 빌드 파이프라인이 단순해서 과도한 도구 도입으로 판단, 기각.
- **pnpm workspaces**: 더 엄격한 의존성 관리. 기존 npm 기반 프로젝트에서 전환 비용 대비 이점 부족, 기각.
- **서브모듈 또는 별도 레포**: shared 코드 변경 시 버전 동기화 부담, 기각.

## References

- Plan: context.md
- Related: `packages/shared/src/index.ts`, `packages/extension/vite.config.ts`
