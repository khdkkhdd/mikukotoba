# 0013: 리팩토링 Phase 4~5 완료

## 날짜
2026-02-19

## 상태
완료

## 맥락
Phase 1~3 완료 후, 단어장 연동(Phase 4)과 번역 파이프라인 고도화(Phase 5)를 진행.

## Phase 4 결정사항

### 4.2 단어 클릭 → 단어장
- `createRubyClone`과 `createInlineBlock` 렌더러에 `onWordClick` 콜백 옵션 추가
- `WordClickCallback` 타입을 `ruby-injector.ts`에서 export, `inline-block.ts`에서 import
- 실제 콜백은 `vocab/word-click-callback.ts`에서 lazy import로 제공 (번들 사이즈 최적화)
- `vocab-click-handler.ts`에서 dynamic import로 vocab-modal, vocab-add-handler 로드
- 모든 핸들러(Twitter, YouTube, Webpage)에서 동일한 콜백 사용
- CSS `.jp-vocab-clickable:hover`로 클릭 가능 시각 피드백

### 4.3 용어집 ↔ 단어장 자동 연동
- Service Worker의 `VOCAB_SAVE` 핸들러에서 glossary custom entries에 직접 추가
- `GLOSSARY_STORAGE_KEY`를 service-worker에서 직접 접근 (GlossaryManager 인스턴스 불필요)
- 중복 체크: 동일 japanese 키가 이미 있으면 스킵
- `note: '단어장에서 자동 추가'` 태그로 출처 표시

### 4.4 검색 성능 개선
- `jp_vocab_search_flat` 키에 검색 필드만 포함한 경량 배열 저장
- `SearchEntry`: id, date, word, reading, romaji, meaning, note
- 검색 시: 플랫 인덱스 → ID 매칭 → 해당 날짜 파티션만 로드
- addEntry/updateEntry/deleteEntry 시 플랫 인덱스 동기 갱신
- `rebuildSearchIndex()` 마이그레이션 함수 추가 (onInstalled에서 호출)

### 4.5 JSON 가져오기
- `VocabStorage.importEntries()`: ID 기반 중복 감지, 날짜별 파티션 병합
- `VOCAB_IMPORT` 메시지 타입 추가
- vocabulary.html에 "가져오기" 버튼 추가

## Phase 5 결정사항

### 5.2 컨텍스트-인식 캐시 키
- `hashKey(text, source?)`: source가 있으면 `${source}:${text}`로 해시
- `memoryCacheKey(text, source?)`: 동일 패턴으로 메모리 캐시 키 생성
- source = `location.hostname` (content script에서 사용)
- 기존 캐시와 호환: source 없이 호출하면 기존 동작과 동일

### 5.3 프롬프트 템플릿화
- `LEVEL_TEMPLATES` 맵: beginner, elementary, intermediate, advanced
- 초급: 쉬운 한국어, 원문 병기 적극
- 고급: 최소 병기, 자연스러운 의역, 경어 세분화
- `buildSystemPrompt(context, level?)` 시그니처 확장
- `LLMClient.translate(text, context, level?)` 인터페이스 확장
- Translator에서 `this.settings.learningLevel`을 LLM 호출 시 전달

### 5.4 요청 큐잉/병합
- `inflight` Map<normalized, Promise>으로 동일 텍스트 in-flight dedup
- skipCache (retranslate) 요청은 dedup 대상에서 제외
- 완료 시 inflight Map에서 제거

### 5.5 피드백 기반 복잡도 학습
- `retranslateScores` 배열에 재번역 시점의 complexityScore 기록 (최대 20개)
- 5개 이상 축적 시, 60% 이상이 임계값 미만이면 평균으로 임계값 하향 조정
- 세션 내 학습 (영구 저장 미적용 — 설정 저장은 사용자 의사 반영 필요)

## 새로 추가된 파일
- `src/content/vocab/vocab-click-handler.ts` — 단어 클릭 → 모달 흐름
- `src/content/vocab/word-click-callback.ts` — 공유 콜백 함수
