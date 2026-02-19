# ミク言葉 (Miku Kotoba)

일본어 학습 보조 Chrome 확장 프로그램. 웹 페이지의 일본어 텍스트에 후리가나, 로마지, 한국어 번역을 표시합니다.

## 주요 기능

- **후리가나** — 한자 위에 히라가나 읽기 표시 (형태소 분석 기반)
- **로마지** — 로마자 발음 표시
- **한국어 번역** — Papago 또는 LLM(Claude, OpenAI, Gemini)을 통한 번역
- **복잡도 기반 엔진 선택** — 간단한 문장은 Papago, 경어/관용구/문맥이 필요한 문장은 LLM 자동 라우팅
- **번역 재시도** — 캐시된 번역이 마음에 들지 않으면 ↻ 버튼으로 LLM 재번역
- **용어집** — 커스텀 용어집 등록 및 CSV 가져오기/내보내기
- **사용자 번역 수정** — 번역 결과를 직접 수정하면 이후 번역에 반영

## 지원 사이트

| 사이트 | 인라인 번역 | 호버 번역 | 자막 번역 | 후리가나 |
|--------|:---------:|:--------:|:--------:|:-------:|
| YouTube | O | O | O | O |
| Twitter/X | O | O | — | O |
| 일반 웹페이지 | O | O | — | O |

### 표시 모드

- **Hover** — 마우스를 올리면 팝업으로 번역 표시
- **Inline** — 원문 아래에 번역 블록 삽입
- **Furigana-only** — 후리가나만 표시 (번역 없음)

## 설치 및 빌드

```bash
npm install
npm run build
```

빌드 결과물은 `dist/` 디렉토리에 생성됩니다.

### Chrome에 로드

1. `chrome://extensions` 접속
2. "개발자 모드" 활성화
3. "압축해제된 확장 프로그램을 로드합니다" → `dist/` 폴더 선택

### 개발 모드

```bash
npm run dev
```

파일 변경 시 자동으로 재빌드됩니다. Chrome에서 확장 프로그램을 새로고침하면 반영됩니다.

## 설정

확장 프로그램 설치 후 옵션 페이지에서 API 키를 설정합니다.

### 번역 엔진

최소 하나의 번역 엔진을 설정해야 합니다:

- **Papago** — [Naver Cloud Platform](https://www.ncloud.com/)에서 Papago Translation API Client ID/Secret 발급
- **Claude** — [Anthropic Console](https://console.anthropic.com/)에서 API Key 발급
- **OpenAI** — [OpenAI Platform](https://platform.openai.com/)에서 API Key 발급
- **Gemini** — [Google AI Studio](https://aistudio.google.com/)에서 API Key 발급

API 키는 `chrome.storage.local`에만 저장되며 클라우드 동기화되지 않습니다.

### 단축키

| 단축키 | 기능 |
|--------|------|
| `Alt+J` | 확장 프로그램 ON/OFF |
| `Alt+F` | 후리가나 표시 토글 |
| `Alt+T` | 번역 표시 토글 |
| `Alt+R` | 로마지 표시 토글 |

## 아키텍처

```
src/
├── background/          # Service Worker (설정 관리, 메시지 허브)
├── content/
│   ├── twitter/         # Twitter/X 핸들러
│   ├── youtube/         # YouTube 자막 + 페이지 핸들러
│   ├── webpage/         # 일반 웹페이지 핸들러
│   └── shared/          # 공용 렌더러 (인라인 블록, 호버 툴팁, 스포일러)
├── core/
│   ├── translator/      # 번역 엔진 (Papago, Claude, OpenAI, Gemini)
│   ├── analyzer/        # 형태소 분석 (Kuromoji)
│   ├── cache.ts         # 2단계 캐시 (메모리 + Chrome Storage)
│   └── glossary.ts      # 용어집 관리
├── popup/               # 팝업 UI
├── options/             # 옵션 페이지
└── types/               # TypeScript 타입 정의
```

### 번역 파이프라인

1. 일본어 텍스트 감지
2. 캐시 조회
3. 형태소 분석 (Kuromoji) → 후리가나/로마지 생성
4. 복잡도 평가 (경어, 관용구, 희귀 한자 등)
5. 엔진 선택 (복잡도 기준) → 번역
6. 용어집 후처리
7. 캐시 저장 + 문맥 윈도우 업데이트

## 기술 스택

- **Manifest V3** Chrome Extension
- **TypeScript** + **Vite** (빌드)
- **Kuromoji** — 일본어 형태소 분석
- **Kuroshiro** — 후리가나/로마지 변환
- **Playwright** — E2E 테스트

## 라이선스

MIT
