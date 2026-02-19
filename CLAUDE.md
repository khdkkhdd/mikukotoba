# ミク言葉 (Miku Kotoba)

일본어 학습 모노레포: Chrome extension + iOS mobile app.

## Structure

```
packages/
  shared/     # 공유 코드 (타입, Drive API, sync-core)
  extension/  # Chrome 확장
  mobile/     # React Native (Expo) iOS 앱
```

## Stack

- **shared**: TypeScript (순수 fetch 기반 Drive API, 동기화 로직)
- **extension**: TypeScript, Vite, Chrome Extension Manifest V3 (CRXJS). Papago + LLM, Kuromoji + Kuroshiro.
- **mobile**: Expo (React Native), expo-sqlite, ts-fsrs, Zustand, expo-router

## Build

- extension dev: `cd packages/extension && npm run dev`
- extension build: `cd packages/extension && npm run build`
- mobile: `cd packages/mobile && npx expo start`
- workspace install: `npm install` (루트에서)

## Communication

Use Korean for all user-facing text: commit messages, documentation, comments, PR descriptions, UI strings.

## Documentation

Feature specs go in `docs/` as user-perspective descriptions of what users can do and how things behave. No code references, data models, or implementation details in feature specs.

Decisions go in `decisions/` using the numbered format (NNNN-topic.md).

Task context lives in `context.md` at repo root.

## Architecture

### Extension
Three-layer dependency: Handler → Shared → Core (no reverse). See `context.md` for architecture details.

### Mobile
expo-router 파일 기반 라우팅. SQLite 로컬 DB + FSRS 스케줄링. shared의 DriveAPI/sync-core로 Drive 동기화.
SyncManager (`services/sync-manager.ts`): vocab/FSRS 변경 시 30초 디바운스 push, 백그라운드 전환 시 즉시 flush, 포그라운드 복귀 시 자동 pull.

### Shared
VocabEntry/DriveCardState/DriveFsrsState 타입, DriveAPI (순수 fetch), mergeEntries/cleanTombstones/mergeFsrsStates 동기화 함수. Chrome/RN 양쪽에서 사용.
