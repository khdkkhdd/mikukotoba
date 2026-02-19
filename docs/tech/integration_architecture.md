# 통합 아키텍처: 교차 관심사 분석과 리팩토링 계획

> 이 문서는 5개 기술 명세를 가로지르는 교차 관심사를 다룬다. 개별 기능의 상세 동작은 해당 기술 명세를 참조한다.

---

## 1. 모듈 의존성 구조

### 1.1 3-계층 아키텍처

```
┌───────────────────────────────────────────────────────┐
│                    Handler Layer                       │
│  twitter/   youtube/subtitle   youtube/page   webpage/ │
│  (코디네이터+   (VideoObserver+   (BatchedObserver+  (TextDetector+ │
│   3 sub)      Extractor+Overlay)  ProcessedTracker)  HoverPopup/   │
│                                                    Inline/Furigana)│
├───────────────────────────────────────────────────────┤
│                    Shared Layer                        │
│  batched-observer  processed-tracker  status-indicator │
│  dom-utils         handlers/registry  handlers/types   │
│  renderers/ (hover-tooltip, ruby-injector,             │
│    inline-block, inline-bracket, furigana-block,       │
│    spoiler, engine-badge)                              │
├───────────────────────────────────────────────────────┤
│                     Core Layer                         │
│  translator/ (index, papago, claude, openai, gemini,   │
│    llm-registry, context-manager, complexity,          │
│    prompt-builder, api-fetch)                          │
│  analyzer/ (morphological, reading-converter)          │
│  cache  glossary  logger  vocab-storage                │
└───────────────────────────────────────────────────────┘
```

**의존성 규칙**: Handler → Shared, Handler → Core, Shared → Core. 역방향 의존은 없다.

### 1.2 사이트별 Shared 모듈 사용 매트릭스

| Shared 모듈 | Twitter | YouTube Subtitle | YouTube Page | Webpage |
|---|:---:|:---:|:---:|:---:|
| BatchedObserver | - | - | O | - |
| TwitterObserver (자체) | O | - | - | - |
| TextDetector (자체) | - | - | - | O |
| ProcessedTracker | O | - | O | - |
| HoverTooltip | O | - | O | O (via HoverPopup) |
| createInlineBlock | O | - | O | - |
| createRubyClone | O | - | O | - |
| createStyledFuriganaBlock | - | - | O | - |
| spoiler | O | - | O | - |
| engine-badge | O | O | O | O |
| StatusIndicator | O | O | O | O |

### 1.3 Background Service Worker 의존성

Service Worker는 Content Script와 별도의 의존성 트리를 갖는다.

```
background/service-worker.ts
├── core/translator/{papago, claude, openai, gemini}  ← API 키 테스트 전용
├── core/vocab-storage                                ← 단어장 CRUD
└── types/index                                       ← 메시지·설정 타입
```

Service Worker는 `translator` 싱글턴을 사용하지 않는다. API 키 검증을 위해 개별 클라이언트를 직접 임포트한다. 번역 실행은 전적으로 Content Script에서 이루어진다.

### 1.4 핵심 발견: 구조적 중복

1. **DOM 감지 3중 구현**: `TwitterObserver`, `BatchedObserver`, `TextDetector`가 동일한 배치 패턴(pendingNodes Set → requestIdleCallback flush)을 독립적으로 구현한다. TwitterObserver는 BatchedObserver와 거의 동일한 코드 구조를 갖지만 하드코딩된 셀렉터 라우팅을 사용한다.
2. **ProcessedTracker 미적용**: Webpage 핸들러는 자체 `processedBlocks: WeakSet`과 `processedElements: WeakSet`을 사용하며, 공유 ProcessedTracker를 사용하지 않는다.
3. **재시작 조건 복사**: 3개 핸들러(Twitter, YouTube Page, Webpage)가 동일한 `needsRestart` 조건 코드를 복사하고 있다 (6절 참조).

---

## 2. 렌더링 모드 통합 설계

### 2.1 모드 × 핸들러 렌더링 경로 매트릭스

| 모드 | Twitter | YouTube Page (main) | YouTube Page (rich) | YouTube Page (label) | Webpage |
|---|---|---|---|---|---|
| **hover** | HoverTooltip + WeakSet 등록 | HoverTooltip + furigana 선택 주입 | HoverTooltip + createRubyClone | HoverTooltip + WeakSet 등록 | HoverPopup → HoverTooltip |
| **inline** | createInlineBlock + createRubyClone + spoiler | createStyledFuriganaBlock + createInlineBlock + spoiler | createRubyClone + createInlineBlock + spoiler | createLabelBlock (번역) | injectFurigana + 수동 div 조립 |
| **furigana-only** | createRubyClone | createStyledFuriganaBlock | createRubyClone | createLabelBlock (읽기) | FuriganaInjector |

YouTube Subtitle은 별도 시스템(SubtitleOverlay)으로 webpageMode에 종속되지 않는다. 번역 공통 기술 명세 16절 참조.

### 2.2 후리가나 3가지 방식 비교

| 방식 | 모듈 | 원리 | 장점 | 단점 | 사용처 |
|---|---|---|---|---|---|
| **createRubyClone** | `renderers/ruby-injector.ts` | 원본 요소를 클론하여 텍스트 노드에 `<ruby><rt>` 삽입 | 링크·@멘션·타임스탬프 보존 | 원본 숨기기 필요 | Twitter, YouTube rich |
| **createStyledFuriganaBlock** | `renderers/furigana-block.ts` | 독립 div에 `tokensToFuriganaHTML` 렌더 + 원본 스타일 복사 | 원본과 시각적 일치 | 원본 구조 미보존 | YouTube main |
| **injectFurigana** | `webpage/inline-translator.ts` | 원본 텍스트 노드를 `<ruby><rt>` span으로 교체 | 별도 요소 불필요 | 원본 파괴적 수정, lineHeight 하드코딩 | Webpage inline |

### 2.3 스포일러 비일관성

| 핸들러 | 스포일러 적용 | 방식 |
|---|:---:|---|
| Twitter | O | `renderers/spoiler.ts` + blur 필터 (twitter 기술 명세 7절) |
| YouTube Page | O | `createInlineBlock`의 `spoiler: true` 옵션 |
| Webpage | **X** | InlineTranslator가 수동 div 조립, spoiler 옵션 없음 |

### 2.4 HoverPopup 래퍼의 역할

`webpage/hover-popup.ts`는 `HoverTooltip`에 대한 얇은 래퍼로, `getTextBlockAtPoint()` 콜백만 제공한다. Twitter와 YouTube Page는 HoverTooltip을 직접 생성하면서 각자의 `getTargetAtPoint`를 제공한다. 세 경우 모두 동일한 패턴(HoverTooltip 생성 → mount/unmount → getTargetAtPoint 콜백)을 따르므로, HoverPopup 클래스를 제거하고 Webpage 핸들러에서 HoverTooltip을 직접 사용해도 무방하다.

---

## 3. 일본어 판별 전략 분기

### 3.1 5가지 판별 전략 비교표

| 전략 | 함수 / 위치 | 판별 기준 | 사용처 |
|---|---|---|---|
| **lang 속성 우선** | `twitter/utils.ts` `isJapaneseText()` | `lang="ja"` 속성 → isJapanese 폴백 | Twitter 트윗·유저 설명 |
| **isJapanese** | `shared/dom-utils.ts` | 히라가나/카타카나 1자 이상 존재 | Twitter 폴백, Webpage 텍스트 노드, TextDetector rescan |
| **isJapaneseShortText** | `twitter/utils.ts` | isJapanese 또는 CJK 비율 >= 50% | Twitter 유저 이름 (純漢字 이름 대응) |
| **containsJapaneseLike** | `shared/dom-utils.ts` | 히라가나/카타카나/CJK 한자 1자 이상 | YouTube Page 모든 요소 |
| **japaneseRatio** | `shared/dom-utils.ts` | 히라가나/카타카나 존재 + 일본어 문자 비율 계산 | Webpage 블록 판별 (>0.1), 페이지 일본어 감지 (>0.1) |

### 3.2 전략 선택 근거

- **Twitter**: `lang="ja"` 속성을 X가 제공하므로 zero-cost 우선 경로. 순수 한자 사용자명(田中太郎)은 kana가 없으므로 별도 CJK 비율 검사 필요.
- **YouTube Page**: `containsJapaneseLike`로 넓게 잡는다. YouTube가 lang 속성을 요소 단위로 제공하지 않으며, 제목에 한자만 포함되는 경우가 많으므로 CJK 포함이 합리적. 오탐은 ProcessedTracker와 번역 캐시에서 흡수.
- **Webpage**: `japaneseRatio > 0.1` 임계값으로 중국어 페이지 오탐을 방지. kana 존재를 전제로 하므로 순중국어 텍스트는 japaneseRatio가 0을 반환한다.

### 3.3 통합 방향

완전 통합보다는 공유 유틸리티 정비 + 사이트별 config 분기가 적합하다.

- `dom-utils.ts`의 3함수(`isJapanese`, `containsJapaneseLike`, `japaneseRatio`)는 범용 빌딩 블록으로 유지
- `isJapaneseShortText`를 `dom-utils.ts`로 이동하여 다른 핸들러에서도 사용 가능하게 정리
- 각 핸들러가 사이트 특성에 맞는 전략을 선택하는 현재 구조는 유지 (YouTube의 lang 부재, Twitter의 lang 활용은 사이트별 차이)

---

## 4. 메시지 통신과 설정 전파

### 4.1 전체 메시지 흐름도

```
                  chrome.storage.sync / local
                         │ onChanged
                         ▼
┌─────────┐  SETTINGS_CHANGED  ┌──────────────────┐  broadcastToAllTabs()  ┌─────────────────┐
│  Popup  │ ──────────────────▶│  Service Worker   │──────────────────────▶│  Content Script  │
│ Options │  MODE_CHANGED      │  (background)     │                       │  (per tab)       │
└─────────┘  TOGGLE_ENABLED    │                   │                       │                  │
                               │                   │◀─────────────────────│                  │
                               │                   │  FETCH_PROXY         │  handler          │
                               │                   │  VOCAB_*             │  .updateSettings()│
                               │                   │  GET_SETTINGS        │                  │
                               │                   │  GET_STATS           │                  │
                               │                   │  TEST_*              │                  │
                               └──────────────────┘                       └─────────────────┘
```

### 4.2 메시지 타입 분류

| 카테고리 | 메시지 타입 | 방향 | 비고 |
|---|---|---|---|
| **설정** | GET_SETTINGS, SETTINGS_CHANGED, TOGGLE_ENABLED, MODE_CHANGED | Popup → SW → Content | 번역 공통 기술 명세 14절 |
| **번역 프록시** | FETCH_PROXY | Content → SW → Content | CORS 우회, `bgFetch()` 구현 |
| **단어장** | VOCAB_SAVE, VOCAB_GET_INDEX, VOCAB_GET_ENTRIES, VOCAB_SEARCH, VOCAB_UPDATE, VOCAB_DELETE, VOCAB_EXPORT | Content/Tab → SW → 응답 | 단어장 기술 명세 6절 |
| **API 테스트** | TEST_PAPAGO, TEST_CLAUDE, TEST_OPENAI, TEST_GEMINI, TEST_RESULT | Popup → SW → Popup | 설정 화면 전용 |
| **통계** | GET_STATS, STATS_RESPONSE | Popup → SW → Popup | 번역 공통 기술 명세 15절 |
| **캐시** | CLEAR_CACHE | Popup → Content | Content 메모리 캐시 초기화 |
| **단어장 시작** | VOCAB_ADD_START | SW → Content | 컨텍스트 메뉴 → 모달 |

### 4.3 YouTube MAIN World 브릿지

YouTube 자막 추출은 페이지의 MAIN world에 접근해야 하므로 별도의 CustomEvent 경로를 사용한다.

```
Content Script (ISOLATED world)          MAIN World Script (caption-bridge.ts)
        │                                          │
        │  CustomEvent: 'jp-helper-get-tracks'     │
        ├─────────────────────────────────────────▶│
        │                                          │ player.getAvailableTracks()
        │  CustomEvent: 'jp-helper-tracks-response'│
        │◀─────────────────────────────────────────┤
        │                                          │
        │  CustomEvent: 'jp-helper-enable-captions'│
        ├─────────────────────────────────────────▶│
        │  CustomEvent: 'jp-helper-fetch-url'      │
        ├─────────────────────────────────────────▶│
```

이 브릿지는 Chrome Extension의 ISOLATED/MAIN world 격리 때문에 필요하다. YouTube 기술 명세 5절 참조.

### 4.4 설정 변경 전파 경로

```
1. Popup/Options에서 chrome.storage.{sync|local}.set() 호출
2. Service Worker의 chrome.storage.onChanged 리스너가 감지
3. Service Worker가 chrome.tabs.sendMessage()로 모든 탭에 브로드캐스트
4. Content Script의 onMessage 리스너가 수신
5. loadSettingsFromStorage()로 전체 설정 재로드 (API 키 포함)
6. applyCSSVariables()로 CSS 변수 즉시 반영
7. translator.configure()로 번역기 설정 갱신
8. 각 activeHandler.updateSettings()로 핸들러별 대응
```

---

## 5. 공유 모듈 조합과 사이트별 차이

### 5.1 DOM 감지 패턴 3가지 비교

| 속성 | TwitterObserver | BatchedObserver | TextDetector |
|---|---|---|---|
| **위치** | `twitter/observer.ts` | `shared/batched-observer.ts` | `webpage/text-detector.ts` |
| **사용 핸들러** | Twitter | YouTube Page | Webpage |
| **라우팅 방식** | 9개 하드코딩 data-testid 셀렉터 | SelectorRoute[] 배열 (동적 추가 가능) | walkTextNodes → findBlockParent |
| **배치 전략** | pendingNodes Set → requestIdleCallback | 동일 | 동일 |
| **characterData 감시** | O (tweetText, userDescription) | O (설정 가능) | O (findBlockParent) |
| **IntersectionObserver** | X | X (핸들러가 별도 관리) | O (내장, rootMargin 200px) |
| **기존 DOM 스캔** | O (scanExisting) | O (scanExisting, 기본값 true) | O (scan(document.body)) |
| **코드 라인** | ~248줄 | ~199줄 | ~227줄 |

**핵심 차이**: TwitterObserver와 BatchedObserver는 거의 동일한 배치 플러시 로직을 갖지만, TwitterObserver는 셀렉터가 코드에 하드코딩되어 있고 콜백 라우팅이 if-else 체인이다. TextDetector는 셀렉터 기반이 아닌 텍스트 노드 워킹 방식이므로 BatchedObserver와 직접 통합은 불가하나, 배치 인프라(pendingNodes + scheduleFlush + requestIdleCallback)는 공유 가능하다.

### 5.2 뷰포트 최적화 현황

| 핸들러 | IntersectionObserver | 상태 |
|---|---|---|
| YouTube Page | 활성 사용 | `deferToViewport`로 label 카테고리 요소를 뷰포트 진입 시 처리 |
| Webpage TextDetector | 생성됨 | IntersectionObserver가 생성되고 요소를 관찰하지만, 주로 MutationObserver의 보조 역할 |
| Twitter | 미사용 | 가상 스크롤이 DOM 자체를 재활용하므로 뷰포트 기반 최적화 대신 DOM 감시로 충분 |

### 5.3 배치 처리 비교

| 핸들러 | 배치 단위 | 청크 크기 | 양보 방식 |
|---|---|---|---|
| Twitter | mutation 배치 → idle flush | 전체 배치를 한 번에 라우팅 | requestIdleCallback (flush 단위) |
| YouTube Page | mutation 배치 → idle flush | 요소별 즉시 처리 또는 viewport defer | requestIdleCallback (flush 단위) |
| Webpage (inline) | TextDetector 배치 → processBlocks | 5개 블록 청크 | requestIdleCallback (청크 간) |
| Webpage (furigana) | TextDetector 배치 → processBlocks | 100개 텍스트 노드 | requestIdleCallback (청크 간) |

### 5.4 SPA 네비게이션 대응

| 핸들러 | 전략 | 구현 |
|---|---|---|
| Twitter | 불필요 | TwitterObserver가 연속적 DOM mutation을 감시. SPA 전환 시에도 새 노드가 추가되면 자동 감지 |
| YouTube Page | 이벤트 기반 + 점진적 재스캔 | `yt-navigate-finish` 이벤트 → cleanup → observer 재시작 → 3단계 지연 재스캔(500/1500/3000ms) + stale 감지 |
| YouTube Subtitle | URL 폴링 | VideoObserver가 주기적으로 URL 변경을 확인 (YouTube 기술 명세 3절) |
| Webpage | 미대응 | SPA에서 페이지 전환 시 새 콘텐츠를 감지하지 못할 수 있음 |

### 5.5 동시성 제어

| 수준 | 메커니즘 | 설정 |
|---|---|---|
| Translator | 최대 3개 동시 요청 + 큐 | `core/translator/index.ts` |
| YouTube rich content | 단락별 순차 번역 | `page-handler.ts` processRichContent() |
| Webpage inline | 5-블록 청크 병렬 → idle 양보 | `inline-translator.ts` processBlocks() |

---

## 6. 설정 전파와 핸들러 재시작

### 6.1 updateSettings() 재시작 조건

3개 핸들러(Twitter, YouTube Page, Webpage)가 동일한 재시작 판별 코드를 복사하고 있다.

```typescript
// twitter/index.ts:113, youtube/page-handler.ts:191, webpage/index.ts:88
const needsRestart =
  settings.webpageMode !== prev.webpageMode ||
  settings.showFurigana !== prev.showFurigana ||
  settings.showTranslation !== prev.showTranslation ||
  settings.showRomaji !== prev.showRomaji;
```

재시작 시 동작도 동일하다: `stop()` → 상태 초기화 → `start()`. 이 로직을 공유 유틸리티나 기반 클래스로 추출하면 일관성을 보장할 수 있다.

### 6.2 CSS 변수 기반 실시간 스타일 반영

재시작 없이 즉시 반영되는 설정 항목:

```
--jp-inline-color-furigana     → 후리가나 색상
--jp-inline-color-romaji       → 로마지 색상
--jp-inline-color-translation  → 번역 색상
--jp-inline-font-scale         → 번역 폰트 배율
--jp-inline-furigana-scale     → 후리가나 폰트 배율
```

이 CSS 변수들은 `content/index.ts`의 `applyCSSVariables()`에서 설정되며, 모든 핸들러의 렌더링에 즉시 영향을 미친다. 재시작이 필요한 설정(모드·표시 토글)과 CSS 변수로 충분한 설정(색상·크기)이 명확히 분리되어 있다.

---

## 7. 리팩토링 단계 계획

각 Phase는 이전 Phase에 의존한다. Phase 내 항목은 병렬 수행 가능하다.

### Phase 1: 공유 인프라 정비

**목표**: 중복 코드 제거, 공유 모듈 경계 명확화

| 항목 | 현재 상태 | 목표 상태 |
|---|---|---|
| TwitterObserver → BatchedObserver 전환 | 하드코딩 셀렉터 + 독자 배치 로직 248줄 | BatchedObserver의 SelectorRoute[] 활용, twitter/observer.ts 제거 |
| TextDetector 배치 인프라 공유 | 자체 pendingNodes + scheduleFlush 구현 | 배치 큐잉·플러시 로직을 공유 유틸리티로 추출, TextDetector는 텍스트 노드 워킹 로직만 보유 |
| ProcessedTracker 전면 적용 | Webpage는 자체 WeakSet 사용 | 모든 핸들러가 ProcessedTracker 사용 |
| 재시작 조건 추출 | 3개 핸들러에서 동일 코드 복사 | 공유 함수 `shouldRestart(prev, next)` 추출 |
| isJapaneseShortText 이동 | `twitter/utils.ts`에만 존재 | `shared/dom-utils.ts`로 이동 |

### Phase 2: 렌더링 통합

**목표**: 사이트 간 렌더링 일관성 확보

| 항목 | 현재 상태 | 목표 상태 |
|---|---|---|
| Webpage 후리가나 → createRubyClone 전환 | injectFurigana가 텍스트 노드를 파괴적으로 수정 | createRubyClone 방식으로 원본 보존, cleanup 안정성 향상 |
| Webpage 스포일러 적용 | inline 모드에서 스포일러 미적용 | createInlineBlock의 spoiler 옵션 활용으로 Twitter·YouTube와 동일 동작 |
| HoverPopup 래퍼 제거 | HoverPopup이 HoverTooltip을 감싸는 얇은 래퍼 | Webpage 핸들러에서 HoverTooltip 직접 사용 (Twitter·YouTube와 동일 패턴) |
| Webpage inline → createInlineBlock 전환 | InlineTranslator가 수동 div 조립 | createInlineBlock 공유 렌더러 활용으로 engine-badge·retry·spoiler 일관 적용 |

### Phase 3: 판별·성능 최적화

**목표**: 불필요한 처리 감소, 뷰포트 기반 우선 처리

| 항목 | 현재 상태 | 목표 상태 |
|---|---|---|
| Webpage IntersectionObserver 활성화 | 보조 역할로만 사용 | 초기 스캔 시 뷰포트 밖 요소는 defer하여 체감 성능 향상 |
| Twitter 뷰포트 우선 처리 | 모든 감지 요소를 즉시 처리 | 가상 스크롤 특성상 큰 효과는 없으나, 대량 스캔 시 뷰포트 내 요소 우선순위 부여 검토 |
| YouTube VideoObserver 이벤트 통합 | URL 폴링 + MutationObserver 혼합 | yt-navigate-finish 이벤트 통합으로 폴링 제거 가능성 검토 (YouTube 기술 명세 3절) |
| Webpage SPA 대응 | 미대응 | popstate/hashchange 감지 + 재스캔 (YouTube Page의 패턴 참고) |

### Phase 4: 단어장 연동·기능 확장

**목표**: 번역 ↔ 단어장 간 양방향 연동

| 항목 | 현재 상태 | 목표 상태 |
|---|---|---|
| 단어 클릭 → 단어장 연동 | 컨텍스트 메뉴를 통한 수동 추가만 가능 | 인라인/후리가나 모드에서 단어 클릭 시 단어장 모달 표시 |
| 용어집 ↔ 단어장 자동 연동 | 독립 운영 | 단어장에 추가된 단어가 용어집에 opt-in 반영 (단어장 기술 명세 7절) |
| 검색 성능 개선 | 전체 파티션 순회 | 인덱스 기반 검색 또는 전문 검색 구조 (단어장 기술 명세 5절) |
| JSON 가져오기 | 내보내기만 지원 | JSON/CSV 가져오기로 외부 단어장 이관 지원 |

### Phase 5: 번역 파이프라인 고도화

**목표**: 번역 품질·효율 향상

| 항목 | 현재 상태 | 목표 상태 |
|---|---|---|
| 컨텍스트-인식 캐시 키 | 텍스트만으로 캐시 키 생성 | 출처(source) 포함 캐시 키로 동일 텍스트의 맥락별 번역 구분 (번역 공통 기술 명세 7절) |
| 프롬프트 템플릿화 | 코드 내 하드코딩 | 레벨별·엔진별 프롬프트 템플릿 분리 (번역 공통 기술 명세 5절) |
| 요청 큐잉/병합 | Translator의 max 3 동시 제한 | 동일 텍스트 중복 요청 병합, 우선순위 큐 도입 |
| 피드백 기반 복잡도 학습 | 고정 가중치 | 재번역 요청 패턴으로 복잡도 임계값 자동 조정 (번역 공통 기술 명세 3절) |

---

## 참조

- [번역 공통 기술 명세](./translation_common_tech.md) — 공유 렌더러(16절), 핸들러 레지스트리(17절), 메시지 통신(14절)
- [Twitter 기술 명세](./twitter_tech.md) — TwitterObserver(2절), 스포일러(7절), 판별(8절)
- [YouTube 기술 명세](./youtube_tech.md) — MAIN world 브릿지(5절), SPA 대응(9절), 자막 추출(4절)
- [Webpage 기술 명세](./webpage_tech.md) — TextDetector(2절), 렌더링 모드(3-5절)
- [단어장 기술 명세](./vocab_tech.md) — 메시지 프로토콜(6절), 번역 연동(7절)
- [Decision 0008](../../decisions/0008-integration-architecture-scope.md) — 문서 범위 결정
