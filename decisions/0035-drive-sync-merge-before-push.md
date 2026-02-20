# Drive 동기화 merge-before-push + 메타데이터 버전 머지

Status: accepted
Date: 2026-02-20

## Context

익스텐션 → 모바일 태그 동기화가 작동하지 않음. 진단 결과 Drive와 모바일 DB 모두 tags=[]로 확인. 분석 결과 두 가지 아키텍처 문제를 발견:

1. 모바일 `pushToDrive`가 Drive 파티션을 merge 없이 덮어쓰면서 익스텐션 데이터 소실
2. 양쪽 기기가 메타데이터 `partitionVersions`를 전체 덮어쓰면서 상대방 버전 번호 소실

## Decision

### 1. merge-before-push (mobile pushToDrive)

각 파티션 push 전에 Drive 기존 데이터를 읽어 `mergeEntries`로 머지한 후 push. `pushReviewLogs`에 이미 적용된 동일 패턴.

```typescript
// push 전 Drive 데이터와 머지
if (fileId) {
  const remote = await DriveAPI.getFile(token, fileId);
  entries = mergeEntries(entries, remote.entries, tombstones);
  await db.upsertEntries(database, entries);
}
```

### 2. 메타데이터 버전 머지 (양쪽)

메타데이터 push 시 리모트를 먼저 읽고, 날짜별 max version을 취하여 버전 역행 방지.

```typescript
const mergedVersions = { ...remoteVersions };
for (const [date, version] of Object.entries(meta.partitionVersions)) {
  mergedVersions[date] = Math.max(version, mergedVersions[date] || 0);
}
```

## Consequences

### Positive
- Drive 데이터 덮어쓰기로 인한 데이터 소실 방지
- 버전 번호 역행으로 인한 pull 미작동 문제 해결
- pushReviewLogs와 일관된 패턴

### Negative
- push당 API 호출 증가 (파티션별 1회 read 추가, 메타데이터 1회 read 추가)
- fullSync 시 날짜 수 × 2 API 호출 (read + write)
- 이 수정만으로는 근본 원인(Drive에 왜 tags=[]인지) 미해결

## Alternatives Considered

- **dirty dates만 push**: fullSync에서 변경된 날짜만 push. 구현이 복잡하고 첫 동기화 시 전체 push 필요.
- **per-device 버전 추적**: 기기별 버전을 분리 관리. 메타데이터 스키마 변경 필요, 마이그레이션 부담.

## References

- Plan: context.md
- Related: `packages/mobile/src/services/sync.ts`, `packages/extension/src/core/drive-sync.ts`
