# Goal

후리가나 읽기 정확도 개선. 두 가지 문제 해결:
1. **다독음 한자 오독** — 今日, 大人, 生 등에서 문맥에 맞지 않는 읽기 선택
2. **신조어·고유명사 미인식** — kuromoji v0.1.2 + IPAdic(2007) 사전의 한계

4단계 파이프라인: 사전 확장(P1) → 정적 오버라이드(P2) → 문맥 규칙(P3) → LLM 보정(P4)

# Research

## kuromoji v0.1.2 실출력 검증 결과

대부분 정확하지만 문제 케이스 확인:
- `一人` → `一(いち)` + `人(にん)` 분리 (ひとり가 아님)
- `二人` → `二(に)` + `人(にん)` 분리 (ふたり가 아님)
- `この間` → `このかん` (일상적으로 このあいだ)
- `日本` → `にっぽん` (にほん이 더 보편적이나 둘 다 유효)
- 今日, 明日, 大人, 下手, 上手 등은 기본 사전으로 정확

## 사전 크기 제약

- 원본 dict: ~17MB (392K 엔트리)
- NEologd 전체: 3.2M 엔트리 → 198MB (Chrome extension에 부적합)
- NEologd 필터링(한자 포함 고유명사 350K): ~30MB (허용 가능)

## NEologd 필터링 기준

mecab-user-dict-seed의 POS 분포 (한자 포함):
- 名詞,固有名詞,一般: 569K / 人名: 506K / 地域: 504K / 組織: 246K
- 名詞,一般,*: 168 / サ変接続: 185
- 짧은 surface 우선 정렬 후 350K개 선택 → 자주 등장하는 단어 우선

## DictionaryBuilder API (kuromoji)

`kuromoji.dictionaryBuilder()` → `addTokenInfoDictionary(csvLine)` → `putCostMatrixLine()` → `putCharDefLine()` → `putUnkDefLine()` → `build()` → DynamicDictionaries. 12개 .dat 파일 생성 후 gzip.

## 파일 참조

- `packages/extension/src/core/analyzer/morphological.ts` — MorphologicalAnalyzer, analyze()
- `packages/extension/src/core/translator/index.ts` — Translator.doTranslate()
- `packages/extension/src/types/index.ts` — MorphemeToken 인터페이스
- `packages/extension/dict/*.dat.gz` — kuromoji 바이너리 사전
- `node_modules/kuromoji/src/dict/builder/DictionaryBuilder.js` — 빌더 소스
- `node_modules/mecab-ipadic-seed/` — IPAdic seed 데이터

# Plan

## Decisions

- **P2 데이터 분리**: 교정 목록을 `reading-overrides.json`으로 분리. Vite JSON import로 빌드 시 자동 번들. CLI 도구(`tools/add-reading-override.mjs`)로 추가 가능
- **P2 안전장치**: `kuromojiReading` 필드로 잘못된 읽기일 때만 교정. 이미 맞는 결과는 건드리지 않음
- **P3 토큰 분리 대응**: 一+人 → ひと+り 같이 개별 토큰 읽기를 변경하여 합치면 올바른 읽기가 되도록 규칙 설계
- **P4 위치**: translator의 doTranslate()에서 morphological analysis 직후, complexity 평가 전에 삽입. analyzer가 아닌 translator 레벨에서 LLM client 접근
- **NEologd 용량 제어**: 350K 엔트리 상한, 짧은 surface 우선 정렬. 목표 30MB 이하
- **hiraganaToRomaji 중복**: morphological.ts에서 export하지 않으므로 reading-overrides.ts에서 재정의하고 P3에서 재사용
- **vitest e2e 제외**: Playwright e2e 테스트가 vitest에 의해 잡히므로 `exclude: ['tests/e2e/**']` 설정

## Steps

- [x] vitest 설정
- [x] P1: build-dict.mjs + verify-dict.mjs + benchmark-texts.json + NEologd seeds
- [x] P1: 사전 재빌드 (IPAdic + NEologd 350K) + 검증 (baseline 대비 0 변경)
- [x] P2: reading-overrides.ts (정적 오버라이드)
- [x] P2: reading-overrides.json 데이터 분리 + CLI 도구
- [x] P3: reading-context-rules.ts (문맥 규칙)
- [x] P4: reading-llm-corrector.ts + translator 통합
- [x] morphological.ts에 P2→P3 파이프라인 삽입
- [x] 단위 테스트 19개 작성 + 통과
- [x] tsc + vite build 통과

# Progress

## 완료

모든 P1~P4 구현 완료. 빌드 및 테스트 통과.

### 새 파일
- `packages/extension/vitest.config.ts` — 테스트 설정
- `packages/extension/src/core/analyzer/reading-overrides.json` — P2 교정 데이터 (11개 엔트리)
- `packages/extension/src/core/analyzer/reading-overrides.ts` — P2 로직
- `packages/extension/src/core/analyzer/reading-context-rules.ts` — P3
- `packages/extension/src/core/analyzer/reading-llm-corrector.ts` — P4
- `packages/extension/src/core/analyzer/__tests__/reading-correction.test.ts` — 19개 테스트
- `tools/build-dict.mjs` — 사전 빌드 스크립트
- `tools/verify-dict.mjs` — 사전 검증 스크립트
- `tools/add-reading-override.mjs` — P2 교정 추가 CLI
- `tools/benchmark-texts.json` — 20개 벤치마크 텍스트
- `tools/neologd-seeds/*.csv.xz` — NEologd seed 파일

### 변경 파일
- `packages/extension/src/core/analyzer/morphological.ts` — P2→P3 파이프라인 삽입
- `packages/extension/src/core/translator/index.ts` — P4 LLM 보정 삽입
- `packages/extension/dict/*.dat.gz` — 재빌드 사전 (17MB → 30MB)
- `packages/extension/package.json` — vitest, mecab-ipadic-seed 추가, test 스크립트
- `package.json` — build:dict, verify:dict, add:override 스크립트
- `.gitignore` — neologd CSV, baseline.json 제외

# Others

### 파이프라인 실행 순서
```
kuromoji tokenize → P2 applyReadingOverrides → P3 applyContextRules → [P4 LLM correctReadingsIfNeeded]
```
P2·P3는 morphological.ts의 analyze() 안에서 동기적 실행. P4는 translator의 doTranslate()에서 비동기 실행 (LLM API 호출 필요).

### 명령어
```bash
npm run build:dict              # IPAdic + NEologd
npm run build:dict:ipadic-only  # IPAdic만 (검증용)
npm run verify:dict             # 현재 dict 검증
npm run verify:dict -- --save baseline    # baseline 저장
npm run verify:dict -- --compare baseline # baseline 비교
npm run add:override -- --surface 初音 --wrong しょおん --correct はつね --note "메모"
```
