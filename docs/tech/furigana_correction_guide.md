# 후리가나 교정 가이드

> 잘못된 후리가나를 발견했을 때 어떤 단계에서, 어떻게 교정을 추가하는지 안내합니다.

---

## 파이프라인 개요

```
원문 텍스트
  │
  ├─ P1  kuromoji 형태소 분석 (IPAdic + NEologd 사전)
  │    → MorphemeToken[] (surface, reading, pos 등)
  │
  ├─ P2  정적 읽기 오버라이드 (reading-overrides.json)
  │    → 단일 토큰의 잘못된 읽기를 교정
  │
  ├─ P3  문맥 규칙 (context-rules.json + TS 규칙)
  │    → 연속 토큰 패턴 또는 앞뒤 문법 조건으로 교정
  │
  └─ P4  LLM 비동기 검증 (다독음 한자 한정)
       → 캐시 + LLM으로 문맥 기반 최종 확인
```

---

## 단계별 교정 방법

### P2: 정적 읽기 오버라이드

**언제 사용**: kuromoji가 특정 단어에 대해 **항상** 같은 잘못된 읽기를 반환할 때.

**예시**: `田舎`를 항상 `たしゃ`로 반환 → `いなか`로 교정.

**안전장치**: kuromoji 반환값이 정확히 `kuromojiReading`과 일치할 때만 교정. 이미 올바른 읽기인 경우 건드리지 않음.

**추가 방법**:

```bash
npm run add:override -- --surface 田舎 --wrong たしゃ --correct いなか --note "메모"
```

| 옵션 | 필수 | 설명 |
|------|------|------|
| `--surface` | O | 표층형 (한자 표기) |
| `--wrong` | O | kuromoji가 반환하는 잘못된 읽기 |
| `--correct` | O | 올바른 읽기 |
| `--note` | X | 메모 |

**데이터 파일**: `packages/extension/src/core/analyzer/reading-overrides.json`

```json
{
  "surface": "田舎",
  "kuromojiReading": "たしゃ",
  "correctReading": "いなか",
  "note": "たしゃ → いなか"
}
```

**판단 기준**:
- 문맥에 관계없이 kuromoji가 항상 같은 오독을 반환하는가? → P2
- 문맥에 따라 읽기가 달라지는가? → P3 또는 P4

---

### P3: 문맥 규칙

**언제 사용**: 연속된 토큰 조합이나 앞뒤 문법 요소에 따라 읽기가 결정될 때.

#### Type A — 연속 토큰 패턴 (JSON)

**언제 사용**: 연속된 토큰의 surface만 보고 읽기를 결정할 수 있을 때.

**예시**: `一` + `人` → `ひと` + `り` (ひとり)

**추가 방법**:

```bash
npm run add:context-rule -- --pattern "一,人" --readings "ひと,り" --when "いち,にん" --note "ひとり"
```

| 옵션 | 필수 | 설명 |
|------|------|------|
| `--pattern` | O | 연속 토큰 surface (쉼표 구분) |
| `--readings` | O | 교정할 읽기 (쉼표 구분, pattern과 같은 길이) |
| `--when` | X | 현재 읽기 조건 (쉼표 구분, 생략 시 surface만 매칭) |
| `--note` | X | 메모 |

**데이터 파일**: `packages/extension/src/core/analyzer/context-rules.json`

```json
{
  "pattern": ["一", "人"],
  "readings": ["ひと", "り"],
  "whenReadings": ["いち", "にん"],
  "note": "ひとり"
}
```

**`whenReadings` 사용 판단**:
- `一` + `人`이 항상 `ひとり`인가? → kuromoji가 `いち` + `にん`으로 분리할 때만 교정해야 하므로 `--when` 필요
- `音` + `ノ` + `乃`는 이 조합 자체가 고유명사이므로 `--when` 불필요

#### Type B — 문법 조건 규칙 (TypeScript)

**언제 사용**: POS(품사) 태그 확인, suffix 목록 비교 등 단순 surface 매칭으로 표현할 수 없을 때.

**예시**:
- `下手` + `[な/だ/です/に/で]` → `へた` (na형용사 용법 확인)
- `今日` + `[助詞/助動詞/문말]` → `きょう`
- `一` + `日` (뒤에 `中`이 아닐 때) → `ついたち`

**추가 방법**: `reading-context-rules.ts`의 `CONTEXT_RULES` 배열에 직접 추가.

```typescript
{
  surface: '下手',
  condition: (_, next, token) =>
    token.reading !== 'へた' && surfaceIs(next, 'な', 'だ', 'です', 'に', 'で'),
  correctReading: 'へた',
},
```

**`condition` 파라미터**:
- `prev`: 이전 토큰 (없으면 `null`)
- `next`: 다음 토큰 (없으면 `null`)
- `token`: 현재 토큰

**헬퍼 함수**:
- `isParticle(token)` — 助詞 여부
- `isAuxVerb(token)` — 助動詞 여부
- `surfaceIs(token, ...values)` — surface 일치 여부

---

### P4: LLM 읽기 검증

**동작 방식**: P1~P3 이후에도 다독음 한자가 포함된 토큰이 있으면 LLM에 문맥 기반 검증 요청. 비동기 처리이며, LLM 설정이 없으면 건너뜀.

**대상 한자** (24자):
```
生 行 上 下 中 間 日 月 風 方 物 気 前 後 人 何 分 切 重 開 明 正 通 手
```

**캐시**: `chrome.storage.local`에 90일 TTL로 저장. 같은 앞뒤 문맥이면 캐시 히트.

**사용자 설정 불필요** — LLM이 설정되어 있으면 자동 동작.

**다독음 한자 추가**: `reading-llm-corrector.ts`의 `AMBIGUOUS_KANJI` Set에 한자 추가.

---

## 어떤 단계를 선택해야 하나?

```
잘못된 후리가나 발견
  │
  ├─ kuromoji가 항상 같은 오독을 반환?
  │    → YES → P2 (add:override)
  │
  ├─ 연속 토큰 조합으로 결정?
  │    ├─ surface만으로 판단 가능? → P3 Type A (add:context-rule)
  │    └─ POS/문법 조건 필요? → P3 Type B (TS 코드)
  │
  └─ 문맥에 따라 읽기가 달라지는 다독음 한자?
       → P4 대상 한자 목록에 포함되어 있는지 확인
         → 없으면 AMBIGUOUS_KANJI에 추가
```

---

## 교정 추가 후 검증

```bash
# 빌드 (tsc 타입체크 + vite 번들링)
cd packages/extension && npm run build

# 테스트
npx vitest run
```
