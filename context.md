# Goal

Google Drive 동기화 최적화: 순차 HTTP ~80회(~30초+) → 병렬 ~40회(~3-5초).

3가지 축: (1) listFiles 일괄 조회 (2) 파티션 병렬화 (3) 메타 읽기/쓰기 통합.

# Research

## 병목 분석

- 파티션마다 `findFileByName` 순차 호출 → ~36회 HTTP
- 3종(vocab/FSRS/review) pull/push 각각 meta 읽기/쓰기 → ~6회 HTTP
- API 호출이 압도적 병목, 내부 merge 연산은 무시할 수준

## 핵심 이슈

- **listFiles 페이지네이션 미지원**: pageSize=100, nextPageToken 무시 → 3개월 사용 시 100파일 초과
- **commitSyncMeta 재읽기+머지 필수**: stale version overwrite 방지를 위해 remote meta 재읽기 후 Math.max 머지
- **flush에서 listFiles 불필요**: 1-2개 파티션 push에 전체 listFiles는 과잉
- **SyncContext 분리**: sync-core.ts는 순수 함수만 유지, 새 파일 sync-context.ts로 분리

# Plan

## 아키텍처

- `SyncContext`: token + fileIdMap(listFiles 1회) + remoteMeta(읽기 1회) + versionPatches(push 누적)
- `createSyncContext()` → fullSync/pull 시작 시 1회 생성, 모든 pull/push가 공유
- `commitSyncMeta()` → push 완료 후 재읽기 + Math.max 머지 + 1회 쓰기
- flush 경량 경로: ctx 미사용, 기존 ensureDriveFileId 캐시 활용

## 수정 파일

| 파일 | 변경 |
|------|------|
| `shared/src/drive-api.ts` | listFiles nextPageToken 페이지네이션 |
| `shared/src/sync-core.ts` | buildFileIdMap, resolveFileId, parallelMap 헬퍼 |
| `shared/src/sync-context.ts` | 신규 — SyncContext, createSyncContext, commitSyncMeta |
| `shared/src/index.ts` | 새 export 추가 |
| `mobile/src/services/sync.ts` | pull/push에 ctx 파라미터 + parallelMap 병렬화 |
| `mobile/src/services/sync-manager.ts` | fullSync ctx 공유 + 3종 pull Promise.all |
| `extension/src/core/drive-sync.ts` | pull/pushAll ctx 기반 + pushPartitionImmediate meta+index 병렬 쓰기 |

# Progress

- [x] `drive-api.ts` — listFiles 페이지네이션 (nextPageToken 루프)
- [x] `sync-core.ts` — buildFileIdMap, resolveFileId, parallelMap 추가
- [x] `sync-context.ts` — SyncContext 타입, createSyncContext, commitSyncMeta 구현
- [x] `index.ts` — 새 export 추가
- [x] `mobile/sync.ts` — 모든 pull/push에 optional ctx 파라미터, parallelMap 병렬 fetch/push
- [x] `mobile/sync-manager.ts` — fullSync: ctx 생성 → 3종 pull 병렬 → push → commitSyncMeta 1회
- [x] `extension/drive-sync.ts` — pull/pushAll: createSyncContext + parallelMap, pushPartitionImmediate: meta+index Promise.all
- [x] 빌드 검증: extension build + mobile tsc --noEmit 성공
