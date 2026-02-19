# Goal

JP Helper Chrome Extension 리팩토링 — Phase 1~5 전체 완료.
코드 품질, 공유 인프라, 단어장 연동, 번역 파이프라인 고도화까지 달성.

# Research

## 아키텍처

```
Handler → Shared → Core (역방향 없음)
```

- **Core** `src/core/` — translator, analyzer, cache, glossary, vocab-storage, logger
- **Shared** `src/content/shared/` — batched-observer, processed-tracker, dom-utils, status-indicator, renderers/
- **Handler** `src/content/{twitter,youtube,webpage}/` — 사이트별 핸들러
- **Vocab** `src/content/vocab/` — vocab-modal, vocab-add-handler, vocab-click-handler, word-click-callback, selection-capture

## 주요 패턴

- **렌더링**: `createInlineBlock(result, settings, opts)`, `createRubyClone(el, tokens, opts)` — 모든 핸들러가 동일 렌더러 사용
- **상태 관리**: `ProcessedTracker` — markProcessed/isProcessed/cleanup
- **설정 변경**: `needsRenderRestart(prev, next)` → true면 stop→start
- **단어 클릭**: `onWordClick` 콜백이 렌더러 → `word-click-callback.ts` → lazy `vocab-click-handler.ts` → `showVocabModal`
- **캐시**: `TranslationCache.get/set/delete(text, source?)` — hostname 기반 컨텍스트 분리
- **프롬프트**: `LEVEL_TEMPLATES[learningLevel]` — beginner/elementary/intermediate/advanced
- **요청 관리**: `inflight` Map으로 in-flight dedup, max 3 동시 + FIFO 큐
- **복잡도 학습**: `retranslateScores` 배열 → 60% 이상 임계값 미만이면 자동 하향

## 스토리지 키

| 키 | 용도 |
|---|---|
| `jp_vocab_index` | 날짜 목록 + 총 개수 |
| `jp_vocab_YYYY-MM-DD` | 날짜별 VocabEntry[] |
| `jp_vocab_search_flat` | 검색 전용 경량 배열 |
| `jp_glossary_custom` | 사용자 용어집 (단어장 자동 추가 포함) |
| `jp_cache_*` | 번역 캐시 (hostname 포함 해시) |
| `jp_cache_index` | 캐시 키 목록 + 타임스탬프 |

# Plan

## Decisions

Phase 1~3: `decisions/0011-*.md`, `decisions/0012-*.md`
Phase 4~5: `decisions/0013-refactoring-phase4-5-completed.md`

핵심 결정:
- 단어 클릭은 렌더러에 `onWordClick` 콜백 옵션으로 구현 (렌더러 API 확장)
- 용어집 연동은 service-worker에서 storage 직접 접근 (GlossaryManager 인스턴스 불필요)
- 검색 인덱스는 플랫 배열 방식 (역인덱스 대비 구현 단순, 1000개 이내 충분)
- 캐시 키에 hostname 포함 (선택적, source 없으면 기존 호환)
- 프롬프트 템플릿 4단계 (UserSettings.learningLevel 기반)
- 복잡도 학습은 세션 내 (영구 저장 미적용 — 설정 변경은 사용자 의사 존중)

## Steps

리팩토링 전체 완료. 남은 작업 없음.

# Progress

- [x] Phase 1: 공유 인프라 정비 (`192d71f`)
- [x] Phase 2: 렌더링 통합 (`192d71f`)
- [x] Phase 3: 판별·성능 최적화 (`47297c8`)
- [x] Phase 4: 단어장 연동·기능 확장 (미커밋)
- [x] Phase 5: 번역 파이프라인 고도화 (미커밋)

Phase 4~5 변경사항은 아직 커밋되지 않음.
