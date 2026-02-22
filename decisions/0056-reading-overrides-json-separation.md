# 읽기 교정 데이터를 JSON 파일로 분리

Status: accepted
Date: 2026-02-22

## Context

P2 읽기 교정 목록이 `reading-overrides.ts`에 TypeScript 배열로 하드코딩되어 있어, 교정 엔트리를 추가할 때마다 TS 코드를 직접 수정해야 했다. 데이터와 로직이 한 파일에 섞여 있어 비개발자나 간단한 추가 작업에 불필요한 마찰이 있었다.

## Decision

교정 데이터를 `reading-overrides.json`으로 분리하고, TS 파일에서 `import overridesData from './reading-overrides.json'`으로 로드한다. CLI 도구(`tools/add-reading-override.mjs`)를 제공하여 중복 체크·정렬을 자동화한다. Vite의 JSON import를 통해 빌드 시 자동 번들된다.

## Consequences

### Positive
- 교정 추가 시 JSON만 편집하면 되므로 TS 문법 오류 위험 없음
- CLI 도구로 중복 체크·surface 정렬이 자동화됨
- `note` 필드로 기존 코드 주석 정보가 데이터에 보존됨
- JSON은 외부 도구(스크립트, CI)로 파싱·검증이 용이

### Negative
- JSON에는 주석을 달 수 없어 "등록하지 않는 이유" 같은 메모가 사라짐 (기존 TS 주석 중 미등록 사유 등)
- 파일이 2개로 분리되어 구조 파악 시 양쪽 확인 필요

## Alternatives Considered

- **TS 하드코딩 유지**: 변경 불필요. 그러나 데이터 추가 시 TS 문법·빌드 오류 가능성, 코드 리뷰 부담 잔존
- **YAML 파일**: 주석 지원으로 메모 가능. 그러나 Vite에서 추가 플러그인 필요, `note` 필드로 대체 가능

## References

- Plan: context.md (P2 데이터 분리)
- Related: `packages/extension/src/core/analyzer/reading-overrides.json`, `packages/extension/src/core/analyzer/reading-overrides.ts`, `tools/add-reading-override.mjs`, `decisions/0055-furigana-reading-accuracy-pipeline.md`
