# ミク言葉 (Miku Kotoba)

일본어 학습 모노레포: Chrome 확장 프로그램 + iOS 모바일 앱.

웹에서 일본어 텍스트에 후리가나·번역을 표시하고, 모르는 단어를 저장해 모바일에서 SRS로 복습합니다. Google Drive를 통해 단어장이 자동 동기화됩니다.

## 구조

```
packages/
  shared/      # 공유 코드 (타입, Drive API, 동기화 로직)
  extension/   # Chrome 확장 프로그램
  mobile/      # React Native (Expo) iOS 앱
```

## Chrome 확장

웹 페이지의 일본어 텍스트에 후리가나, 로마지, 한국어 번역을 표시합니다.

### 주요 기능

- **후리가나** — 한자 위에 히라가나 읽기 표시 (형태소 분석 기반)
- **로마지** — 로마자 발음 표시
- **한국어 번역** — Papago 또는 LLM(Claude, OpenAI, Gemini) 자동 라우팅
- **복잡도 기반 엔진 선택** — 간단한 문장은 Papago, 경어/관용구/문맥이 필요한 문장은 LLM
- **번역 재시도** — ↻ 버튼으로 LLM 재번역
- **용어집** — 커스텀 용어집 등록 및 CSV 가져오기/내보내기
- **단어 저장** — 클릭으로 단어장에 추가, Google Drive 동기화
- **사용자 번역 수정** — 번역 결과를 직접 수정하면 이후 번역에 반영

### 지원 사이트

| 사이트 | 인라인 번역 | 호버 번역 | 자막 번역 | 후리가나 |
|--------|:---------:|:--------:|:--------:|:-------:|
| YouTube | O | O | O | O |
| Twitter/X | O | O | — | O |
| 일반 웹페이지 | O | O | — | O |

### 표시 모드

- **Hover** — 마우스를 올리면 팝업으로 번역 표시
- **Inline** — 원문 아래에 번역 블록 삽입 (스포일러 블러 지원)
- **Furigana-only** — 후리가나만 표시 (번역 없음)

### 단축키

| 단축키 | 기능 |
|--------|------|
| `Alt+J` | 확장 프로그램 ON/OFF |
| `Alt+F` | 후리가나 표시 토글 |
| `Alt+T` | 번역 표시 토글 |
| `Alt+R` | 로마지 표시 토글 |

## 모바일 앱

단어장 기반 SRS(간격 반복) 학습 앱.

### 주요 기능

- **SRS 학습** — FSRS 알고리즘 기반 간격 반복 스케줄링
- **자유 복습 (Relay)** — 태그/날짜 필터링으로 빠른 복습
- **태그 시스템** — 단어를 태그별로 분류 및 태그별 학습
- **학습 통계** — 일별 복습량, 학습 단어 수, 캘린더 뷰
- **Google Drive 동기화** — 단어장·FSRS 상태·복습 기록 자동 양방향 동기화
- **하루 새 단어 수 설정** — 일일 학습량 조절

## 설치 및 빌드

```bash
# 워크스페이스 전체 설치
npm install
```

### 확장 프로그램

```bash
cd packages/extension

# 개발 모드 (파일 변경 시 자동 재빌드)
npm run dev

# 프로덕션 빌드
npm run build
```

빌드 결과물 `dist/` 폴더를 `chrome://extensions` → 개발자 모드 → "압축해제된 확장 프로그램을 로드합니다"로 로드.

### 모바일 앱

```bash
cd packages/mobile

# 개발 서버
npx expo start

# iOS 빌드
npx expo run:ios
```

## 설정

### 번역 엔진 (확장 프로그램)

확장 프로그램 옵션 페이지에서 최소 하나의 번역 엔진 API 키를 설정합니다:

- **Papago** — [Naver Cloud Platform](https://www.ncloud.com/)
- **Claude** — [Anthropic Console](https://console.anthropic.com/)
- **OpenAI** — [OpenAI Platform](https://platform.openai.com/)
- **Gemini** — [Google AI Studio](https://aistudio.google.com/)

API 키는 `chrome.storage.local`에만 저장되며 클라우드 동기화되지 않습니다.

## 기술 스택

| 패키지 | 스택 |
|--------|------|
| shared | TypeScript, 순수 fetch 기반 Drive API, 동기화 로직 |
| extension | TypeScript, Vite, Chrome Extension Manifest V3, Kuromoji, Kuroshiro |
| mobile | Expo (React Native), expo-sqlite, ts-fsrs, Zustand, expo-router |

## 라이선스

MIT
