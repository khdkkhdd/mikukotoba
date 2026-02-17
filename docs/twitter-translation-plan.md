# X/Twitter 인라인 번역 상세 계획

> jp-helper 확장 프로그램의 X/Twitter 전용 번역 핸들러 설계 문서

## 목차

- [아키텍처 개요](#아키텍처-개요)
- [공통 사항](#공통-사항)
- [페이지별 상세 계획](#페이지별-상세-계획)
  - [1. 홈 타임라인](#1-홈-타임라인)
  - [2. 트윗 상세 페이지](#2-트윗-상세-페이지)
  - [3. 프로필 페이지](#3-프로필-페이지)
  - [4. 팔로워/팔로잉 페이지](#4-팔로워팔로잉-페이지)
  - [5. 검색/Explore 페이지](#5-검색explore-페이지)
  - [6. 알림 페이지](#6-알림-페이지)
  - [7. 북마크 페이지](#7-북마크-페이지)
  - [8. 리스트 페이지](#8-리스트-페이지)
  - [9. 커뮤니티 페이지](#9-커뮤니티-페이지)
  - [10. DM/메시지 페이지](#10-dm메시지-페이지)
  - [11. Grok 페이지](#11-grok-페이지)
  - [12. Articles 페이지](#12-articles-페이지)
  - [13. Spaces](#13-spaces)
  - [14. Topics 페이지](#14-topics-페이지)
  - [15. Moments/Events 페이지](#15-momentsevents-페이지)
  - [16. Quote Tweets 페이지](#16-quote-tweets-페이지)
  - [17. Retweets/Likes 목록 페이지](#17-retweetslikes-목록-페이지)
  - [18. 사진/동영상 뷰어](#18-사진동영상-뷰어)
  - [19. 사이드바](#19-사이드바)
- [번역 제외 대상](#번역-제외-대상)
- [구현 모듈 구조](#구현-모듈-구조)
- [캐시 전략](#캐시-전략)

---

## 아키텍처 개요

X/Twitter는 React Native for Web 기반 SPA로, 다음 특성을 가짐:

- CSS 클래스는 난독화되어 빌드마다 변경 → **사용 불가**
- `data-testid` 속성이 **유일하게 안정적인 셀렉터**
- `aria-label` 속성도 비교적 안정적 (접근성 규정상 유지)
- **가상 스크롤링**: 뷰포트 밖 요소는 DOM에서 제거 후 재생성
- React가 DOM을 관리하므로 **원본 텍스트 노드를 직접 수정하면 React가 되돌림**

### 핵심 원칙

1. **원본 DOM 내부를 수정하지 않는다** — 후리가나를 원본 tweetText 안에 주입하면 React reconciliation이 되돌림
2. **형제 요소로 번역을 삽입한다** — 원본 바로 아래에 새 div를 삽입
3. **후리가나는 번역 블록 안에서만 표시** — 원문 복제본에 ruby 태그 적용
4. **캐시 키는 콘텐츠 기반** — DOM 재생성에도 캐시 히트
5. **lang 속성 활용** — `tweetText`에 `lang="ja"` 있으면 일본어 판별 비용 절약

---

## 공통 사항

### 번역 표시 방식 (4가지)

#### 방식 A: 인라인 블록

문장 단위 콘텐츠(트윗 본문, 바이오 등)에 사용. 원본 요소 바로 아래에 번역 블록을 형제 요소로 삽입.

```
┌─────────────────────────────────┐
│ 原文テキスト（元のまま維持）       │  ← 원본 (수정하지 않음)
├─────────────────────────────────┤
│ 原文(げんぶん)テキスト            │  ← 후리가나 처리된 원문 복제
│ genbun tekisuto                 │  ← 로마지 (설정 시)
│ 원문 텍스트                      │  ← 한국어 번역
└─────────────────────────────────┘
```

- 삽입 위치: `element.insertAdjacentElement('afterend', translationDiv)`
- 스타일: 얇은 상단 보더, 약간의 패딩, 원본보다 약간 작은 폰트
- 클래스: `jp-twitter-translation`
- Twitter flex 레이아웃 대응: `width: 100%`, `flex-shrink: 0` 설정

#### 방식 B: 호버 툴팁

짧은 텍스트(유저명, 해시태그, 위치 등)에 사용. 마우스 오버 시 작은 팝업 표시.

```
       ┌───────────────────┐
       │ たなかたろう        │  ← 읽기
       │ Tanaka Tarō       │  ← 로마지
       │ 타나카 타로         │  ← 한국어
       └───────────────────┘
            田中太郎          ← 원본 (호버 대상)
```

- Shadow DOM으로 CSS 격리
- 디바운스: 300ms (빠른 마우스 이동 시 불필요한 번역 방지)
- 위치: 요소 아래 중앙 정렬, 뷰포트 밖이면 자동 조정

#### 방식 C: 인라인 괄호

투표 옵션, 트렌딩 토픽 등 한 줄 텍스트에 사용. 원본 옆에 괄호로 번역 추가.

```
選択肢テキスト (선택지 텍스트)
```

- 삽입: 원본 span 뒤에 `<span class="jp-twitter-inline-hint">` 추가
- 스타일: 연한 색상, 약간 작은 폰트

#### 방식 D: 카드 내부 소형

링크 프리뷰 카드 안에 작은 번역 텍스트 추가.

```
┌─────────────────────────────────┐
│ [이미지]  記事タイトル            │
│           記事の説明テキスト       │
│           기사 제목 / 설명 번역    │  ← 작은 폰트로 추가
└─────────────────────────────────┘
```

### 일본어 판별 기준

1. `lang="ja"` 속성이 있으면 즉시 일본어로 판별 (API 비용 0)
2. 없으면 기존 `isJapanese()` 로직 사용 (히라가나/카타카나 1자 이상)
3. 유저명 등 짧은 텍스트: 한자만 있는 경우도 포함하되, CJK 비율이 50% 이상일 때만

### 텍스트 추출 방법

- `element.innerText.trim()` — 깨끗한 텍스트 (이모지 alt 포함, HTML 태그 제거)
- 해시태그/멘션/URL은 innerText에 자연스럽게 포함됨

---

## 페이지별 상세 계획

---

### 1. 홈 타임라인

**URL**: `/`, `/home`

**컨테이너 구조**:
```
main[role="main"]
  └── div[data-testid="primaryColumn"]
        └── section[role="region"]
              └── div[aria-label="Timeline: Your Home Timeline"]
                    └── div  (가상 스크롤 컨테이너)
                          └── div[data-testid="cellInnerDiv"]  (반복)
                                └── article[data-testid="tweet"]
```

#### 번역 대상 요소

##### 1-1. 트윗 본문

| 항목 | 내용 |
|---|---|
| 셀렉터 | `[data-testid="tweetText"]` |
| 텍스트 특성 | 문장/문단, 1~25,000자, 이모지·해시태그·멘션·URL 포함 |
| 내부 구조 | `<span dir="ltr">` 안에 텍스트 노드 + `<a>` (해시태그/멘션/URL) + 이모지 `<img>` |
| 일본어 판별 | `lang="ja"` 속성 우선, 없으면 `isJapanese()` |
| 텍스트 추출 | `element.innerText.trim()` |
| 번역 방식 | **방식 A (인라인 블록)** |
| 삽입 위치 | `tweetText.insertAdjacentElement('afterend', translationDiv)` |
| 캐시 키 | 트윗 URL — `article.querySelector('time')?.closest('a')?.href` |

주의사항:
- 하나의 `article[data-testid="tweet"]` 안에 `tweetText`가 **2개** 있을 수 있음 (인용 트윗)
- 각 `tweetText`를 독립적으로 처리
- "더 보기" 확장 시 텍스트가 변경됨 → `MutationObserver`의 `characterData`로 감지하여 재번역

##### 1-2. 유저 표시명

| 항목 | 내용 |
|---|---|
| 셀렉터 | `[data-testid="User-Name"]` 내 첫 번째 `a > span > span` (display name) |
| 텍스트 특성 | 1~50자, 한자 이름/카타카나 닉네임/이모지 포함 가능 |
| 일본어 판별 | `isJapanese()` — 한자만 있는 경우 CJK 비율 50% 이상 |
| 번역 방식 | **방식 B (호버 툴팁)** |
| 표시 내용 | 읽기(후리가나) + 로마지 + 한국어 |
| 제외 | `@handle` 부분은 번역하지 않음 |
| 캐시 키 | display name 텍스트 자체 |

##### 1-3. 리포스트 표시

| 항목 | 내용 |
|---|---|
| 셀렉터 | `[data-testid="socialContext"]` |
| 텍스트 특성 | "○○さんがリポスト" — 이름 부분에 일본어 가능 |
| 번역 방식 | **방식 B (호버 툴팁)** — 이름 부분(내부 `<a>` 태그)에만 적용 |
| 캐시 키 | 이름 텍스트 |

##### 1-4. 링크 프리뷰 카드

| 항목 | 내용 |
|---|---|
| 셀렉터 | `[data-testid="card.wrapper"]` 내 타이틀/설명 `<span>` |
| 텍스트 특성 | OGP 타이틀 (10~70자) + 설명 (20~200자) |
| 일본어 판별 | `isJapanese()` |
| 번역 방식 | **방식 D (카드 내부 소형)** |
| 삽입 위치 | 설명 span 아래에 번역 span 추가 |
| 캐시 키 | 카드 링크 URL (`card.wrapper` 내 `<a>` 의 href) |

##### 1-5. 투표 옵션

| 항목 | 내용 |
|---|---|
| 셀렉터 | `[data-testid="card.wrapper"]` 내 poll 옵션 (`[role="radio"]` 또는 옵션 span) |
| 텍스트 특성 | 1~25자/옵션 |
| 번역 방식 | **방식 C (인라인 괄호)** |
| 삽입 위치 | 옵션 텍스트 span 뒤 |
| 캐시 키 | 옵션 텍스트 |

##### 1-6. 이미지 ALT 텍스트

| 항목 | 내용 |
|---|---|
| 셀렉터 | `[data-testid="tweetPhoto"]` 내 ALT 배지 클릭 시 나타나는 팝업 |
| 텍스트 특성 | 이미지 설명, 1~1,000자 |
| 번역 방식 | **방식 A (인라인 블록)** — ALT 팝업 내부에 번역 추가 |
| 트리거 | ALT 팝업이 DOM에 추가되는 것을 MutationObserver로 감지 |
| 우선순위 | 낮음 (Phase 2) |
| 캐시 키 | ALT 텍스트 해시 |

##### 1-7. 커뮤니티 노트

| 항목 | 내용 |
|---|---|
| 셀렉터 | 트윗 article 내 팩트체크 영역 (birdwatch 관련 컨테이너) |
| 텍스트 특성 | 맥락 설명 문장, 50~280자 |
| 번역 방식 | **방식 A (인라인 블록)** |
| 우선순위 | 낮음 (Phase 2) |

---

### 2. 트윗 상세 페이지

**URL**: `/{username}/status/{tweet_id}`

**컨테이너 구조**:
```
div[aria-label="Timeline: Conversation"]
  ├── div[data-testid="cellInnerDiv"]  ← 스레드 상위 트윗(들)
  │     └── article[data-testid="tweet"]
  ├── div[data-testid="cellInnerDiv"]  ← 메인 트윗 (확대 표시)
  │     └── article[data-testid="tweet"]
  └── div[data-testid="cellInnerDiv"]  ← 답글(들)
        └── article[data-testid="tweet"]
```

#### 번역 대상 요소

1번(홈 타임라인)의 모든 요소가 동일하게 적용됨. 추가 사항:

##### 2-1. 스레드 상위 트윗

| 항목 | 내용 |
|---|---|
| 구조 | 메인 트윗 위에 연결선으로 이어진 상위 트윗들 |
| 처리 | 각 트윗을 개별 `tweetText` 단위로 처리 — 1-1과 동일 |

##### 2-2. 메인 트윗

| 항목 | 내용 |
|---|---|
| 특이점 | 더 큰 폰트로 렌더링, 참여 지표 확장 표시 (정확한 숫자) |
| 처리 | 1-1과 동일 — `tweetText` 셀렉터로 동일하게 매칭 |

##### 2-3. 답글 트윗

| 항목 | 내용 |
|---|---|
| 특이점 | 답글 간 연결선, 대댓글 들여쓰기 |
| 처리 | 각 답글을 개별 `tweetText` 단위로 처리 — 1-1과 동일 |

##### 2-4. "답글 대상" 텍스트

| 항목 | 내용 |
|---|---|
| 셀렉터 | `tweetText` 위의 "返信先: @xxx" div |
| 처리 | **번역하지 않음** — UI 템플릿 텍스트 |

---

### 3. 프로필 페이지

**URL**: `/{username}`

**프로필 헤더 + 탭 타임라인** 구조. 탭 타임라인은 1번과 동일하므로 헤더 고유 요소만 기술.

#### 번역 대상 요소

##### 3-1. 프로필 표시명

| 항목 | 내용 |
|---|---|
| 셀렉터 | `[data-testid="UserName"]` (하이픈 없음, 프로필 헤더 전용) |
| 텍스트 특성 | 1~50자 |
| 번역 방식 | **방식 B (호버 툴팁)** |
| 캐시 키 | display name 텍스트 |

##### 3-2. 바이오 (자기소개)

| 항목 | 내용 |
|---|---|
| 셀렉터 | `[data-testid="UserDescription"]` |
| 텍스트 특성 | 1~160자, 해시태그/멘션 포함 가능 |
| 내부 구조 | `tweetText`와 동일 — `<span>` + `<a>` |
| 텍스트 추출 | `element.innerText.trim()` |
| 번역 방식 | **방식 A (인라인 블록)** |
| 삽입 위치 | `UserDescription.insertAdjacentElement('afterend', translationDiv)` |
| 캐시 키 | `@handle` + 바이오 텍스트 해시 |

##### 3-3. 위치

| 항목 | 내용 |
|---|---|
| 셀렉터 | `[data-testid="UserLocation"]` |
| 텍스트 특성 | 지명, 1~30자 (예: "東京都渋谷区") |
| 번역 방식 | **방식 B (호버 툴팁)** |
| 표시 내용 | 읽기 + 한국어 (예: "とうきょうとしぶやく / 도쿄도 시부야구") |
| 캐시 키 | 위치 텍스트 |

##### 3-4. 웹사이트

| 항목 | 내용 |
|---|---|
| 셀렉터 | `[data-testid="UserUrl"]` |
| 처리 | **번역하지 않음** — URL |

##### 3-5. 가입일 / 생년월일

| 항목 | 내용 |
|---|---|
| 셀렉터 | `[data-testid="UserJoinDate"]`, `[data-testid="UserBirthdate"]` |
| 처리 | **번역하지 않음** — UI 텍스트 |

##### 3-6. 프로필 탭 내 트윗

| 항목 | 내용 |
|---|---|
| URL | `/{username}`, `/{username}/with_replies`, `/{username}/media`, `/{username}/likes` |
| 처리 | 1번(홈 타임라인)과 완전 동일 |

---

### 4. 팔로워/팔로잉 페이지

**URL**: `/{username}/followers`, `/{username}/following`, `/{username}/verified_followers`, `/{username}/followers_you_follow`

**컨테이너 구조**:
```
div[data-testid="primaryColumn"]
  └── section[role="region"]
        └── div[data-testid="cellInnerDiv"]  (반복)
              └── div[data-testid="UserCell"]
                    ├── div (아바타)
                    ├── div (이름 + 핸들)
                    │     ├── span (display name)
                    │     └── span (@handle)
                    ├── div (바이오 미리보기)
                    └── button (팔로우 버튼)
```

#### 번역 대상 요소

##### 4-1. 유저 표시명

| 항목 | 내용 |
|---|---|
| 셀렉터 | `[data-testid="UserCell"]` 내 이름 영역 span |
| 번역 방식 | **방식 B (호버 툴팁)** |
| 캐시 키 | display name 텍스트 |

##### 4-2. 바이오 미리보기

| 항목 | 내용 |
|---|---|
| 셀렉터 | `[data-testid="UserCell"]` 내 바이오 텍스트 영역 |
| 텍스트 특성 | 바이오 전체 또는 일부 (잘릴 수 있음) |
| 번역 방식 | **방식 A (인라인 블록)** — 바이오 텍스트 아래에 번역 삽입 |
| 주의 | UserCell 내부 레이아웃이 좁으므로 번역 블록 폰트를 더 작게 조정 |
| 캐시 키 | 바이오 텍스트 해시 |

---

### 5. 검색/Explore 페이지

**URL**: `/explore`, `/search?q={query}`, `/search?q={query}&f=live`, `/search?q={query}&f=user`, `/hashtag/{tag}`

#### 번역 대상 요소

##### 5-1. 검색 결과 트윗 (Top / Latest 탭)

| 항목 | 내용 |
|---|---|
| 처리 | 1번(홈 타임라인)과 완전 동일 |

##### 5-2. 검색 결과 유저 (People 탭)

| 항목 | 내용 |
|---|---|
| 처리 | 4번(팔로워/팔로잉)과 완전 동일 — UserCell 구조 |

##### 5-3. 트렌딩 토픽 (Explore 메인 / 사이드바)

| 항목 | 내용 |
|---|---|
| 셀렉터 | `[data-testid="trend"]` 내 토픽명 span |
| 텍스트 특성 | 해시태그 또는 토픽명, 1~50자 |
| 일본어 판별 | `isJapanese()` |
| 번역 방식 | **방식 C (인라인 괄호)** — 토픽명 옆에 번역 |
| 삽입 위치 | 토픽명 span 뒤에 `<span class="jp-twitter-inline-hint">` |
| 제외 | 카테고리 라벨 ("エンタメ·トレンド" 등) — UI 텍스트이므로 제외 |
| 제외 | 게시물 수 ("1,234件のポスト") — UI 텍스트 |
| 캐시 키 | 토픽명 텍스트 |

##### 5-4. 검색 자동완성

| 항목 | 내용 |
|---|---|
| 셀렉터 | 검색 드롭다운 내 suggestion 항목 |
| 우선순위 | **매우 낮음 (Phase 3)** — 빠르게 사라지고, 번역 지연이 UX를 해침 |
| 현재 계획 | 미구현 |

---

### 6. 알림 페이지

**URL**: `/notifications`, `/notifications/mentions`, `/notifications/verified`

**컨테이너 구조**:
```
div[data-testid="primaryColumn"]
  └── section[role="region"]
        └── div[aria-label*="Notifications" 또는 aria-label*="通知"]
              ├── div[data-testid="cellInnerDiv"]
              │     └── article[data-testid="tweet"]  ← 트윗형 알림
              ├── div[data-testid="cellInnerDiv"]
              │     └── div (비트윗 알림: 팔로우, 좋아요 집계 등)
              └── ...
```

#### 번역 대상 요소

##### 6-1. 트윗형 알림 (멘션, 인용, 답글)

| 항목 | 내용 |
|---|---|
| 구조 | `article[data-testid="tweet"]` 포함 |
| 처리 | 1번(홈 타임라인)과 완전 동일 |

##### 6-2. 비트윗 알림 텍스트

| 항목 | 내용 |
|---|---|
| 구조 | `article[data-testid="tweet"]`가 **없는** cellInnerDiv |
| 텍스트 특성 | "○○さんがいいねしました", "○○さん、△△さん他N人がいいねしました" |
| 번역 대상 | 알림 템플릿 자체는 UI 텍스트 → 번역 불필요. **유저명 부분만** 번역 대상 |
| 번역 방식 | 유저명에 **방식 B (호버 툴팁)** |
| 식별 방법 | 알림 셀 내부의 `<a>` 태그 (유저 프로필 링크)에서 display name 추출 |
| 캐시 키 | display name 텍스트 |

##### 6-3. 집계 알림 (여러 유저)

| 항목 | 내용 |
|---|---|
| 텍스트 특성 | 복수 유저 아바타 + "○○さん、△△さん他N人が..." |
| 처리 | 각 `<a>` 유저 링크에 개별 호버 툴팁 적용 |

---

### 7. 북마크 페이지

**URL**: `/i/bookmarks`, `/i/bookmarks/all`, `/i/bookmarks/{folder_id}`

#### 번역 대상 요소

| 항목 | 내용 |
|---|---|
| 구조 | `article[data-testid="tweet"]` — 홈 타임라인과 동일 |
| 처리 | 1번(홈 타임라인)과 **완전 동일** |

추가 고유 요소 없음.

---

### 8. 리스트 페이지

**URL**: `/i/lists` (리스트 목록), `/i/lists/{list_id}` (리스트 타임라인), `/i/lists/{list_id}/members`, `/{username}/lists`

#### 번역 대상 요소

##### 8-1. 리스트 이름

| 항목 | 내용 |
|---|---|
| 위치 | 리스트 목록 페이지의 각 리스트 카드, 리스트 상세 페이지 헤더 |
| 셀렉터 | 리스트 카드 내 이름 span (특정 data-testid 없음 — cellInnerDiv 내 구조적 위치로 식별) |
| 텍스트 특성 | 1~25자 |
| 번역 방식 | **방식 B (호버 툴팁)** |
| 캐시 키 | 리스트 이름 텍스트 |

##### 8-2. 리스트 설명

| 항목 | 내용 |
|---|---|
| 위치 | 리스트 상세 페이지 헤더 |
| 텍스트 특성 | 1~100자 |
| 번역 방식 | **방식 A (인라인 블록)** |
| 캐시 키 | 리스트 URL + 설명 텍스트 해시 |

##### 8-3. 리스트 타임라인

| 항목 | 내용 |
|---|---|
| 처리 | 1번(홈 타임라인)과 **완전 동일** |

##### 8-4. 리스트 멤버

| 항목 | 내용 |
|---|---|
| 처리 | 4번(팔로워/팔로잉)과 **완전 동일** — UserCell 구조 |

---

### 9. 커뮤니티 페이지

**URL**: `/i/communities` (커뮤니티 홈), `/i/communities/{id}` (커뮤니티 타임라인), `/i/communities/{id}/about`, `/i/communities/{id}/members`

#### 번역 대상 요소

##### 9-1. 커뮤니티 이름

| 항목 | 내용 |
|---|---|
| 위치 | 커뮤니티 헤더 |
| 텍스트 특성 | 1~50자 |
| 번역 방식 | **방식 B (호버 툴팁)** |
| 캐시 키 | 커뮤니티 이름 텍스트 |

##### 9-2. 커뮤니티 설명

| 항목 | 내용 |
|---|---|
| 위치 | About 페이지 |
| 텍스트 특성 | 1~160자 |
| 번역 방식 | **방식 A (인라인 블록)** |
| 캐시 키 | 커뮤니티 URL + 설명 해시 |

##### 9-3. 커뮤니티 규칙

| 항목 | 내용 |
|---|---|
| 위치 | About 페이지의 규칙 목록 |
| 텍스트 특성 | 규칙 제목 + 설명, 각 1~200자 |
| 번역 방식 | **방식 A (인라인 블록)** — 각 규칙 항목 아래에 번역 삽입 |
| 캐시 키 | 규칙 텍스트 해시 |

##### 9-4. 커뮤니티 타임라인

| 항목 | 내용 |
|---|---|
| 처리 | 1번(홈 타임라인)과 **완전 동일** |

##### 9-5. 커뮤니티 멤버

| 항목 | 내용 |
|---|---|
| 처리 | 4번(팔로워/팔로잉)과 **완전 동일** — UserCell 구조 |

---

### 10. DM/메시지 페이지

**URL**: `/messages`, `/messages/{conversation_id}`, `/messages/compose`

**컨테이너 구조**:
```
좌측: 대화 목록
  └── div[data-testid="cellInnerDiv"]  (반복)
        ├── 아바타
        ├── 대화 상대 이름
        └── 마지막 메시지 미리보기

우측: 대화 내용
  └── 메시지 버블 (반복)
        └── span (메시지 텍스트)
```

#### 번역 대상 요소

> **이 페이지는 기본 OFF (옵션)** — 사적 메시지이므로 프라이버시 및 API 비용을 고려하여 사용자가 명시적으로 활성화해야 함.

##### 10-1. 대화 상대 이름

| 항목 | 내용 |
|---|---|
| 위치 | 대화 목록 및 대화 헤더 |
| 번역 방식 | **방식 B (호버 툴팁)** |
| 기본 활성 | **ON** (이름은 프라이버시 이슈 없음) |

##### 10-2. 마지막 메시지 미리보기

| 항목 | 내용 |
|---|---|
| 위치 | 대화 목록의 각 항목 |
| 번역 방식 | **방식 B (호버 툴팁)** |
| 기본 활성 | **OFF** (옵션) |

##### 10-3. 메시지 본문

| 항목 | 내용 |
|---|---|
| 위치 | 대화 내용 영역의 메시지 버블 |
| 텍스트 특성 | 1~10,000자 |
| 번역 방식 | **방식 A (인라인 블록)** — 메시지 버블 아래에 번역 삽입 |
| 기본 활성 | **OFF** (옵션) |
| 캐시 키 | 메시지 텍스트 해시 |

---

### 11. Grok 페이지

**URL**: `/i/grok`

#### 번역 대상 요소

> **이 페이지는 기본 OFF (옵션)** — AI 생성 텍스트로 분량이 매우 크고, Grok 자체가 다국어 응답 가능.

##### 11-1. Grok 응답 텍스트

| 항목 | 내용 |
|---|---|
| 위치 | 채팅 인터페이스의 AI 응답 버블 |
| 텍스트 특성 | 리치 텍스트 (마크다운, 코드블록, 리스트 등), 1~10,000+자 |
| 번역 방식 | **방식 A (인라인 블록)** — 응답 버블 아래에 번역 삽입 |
| 기본 활성 | **OFF** |
| 주의 | 스트리밍 응답 중에는 번역하지 않음 — 응답 완료 후 번역 |
| 캐시 키 | 응답 텍스트 해시 |

---

### 12. Articles 페이지

**URL**: `/i/articles/{article_id}`, `/{username}/articles`

#### 번역 대상 요소

##### 12-1. 기사 제목

| 항목 | 내용 |
|---|---|
| 위치 | 기사 헤더 h1/h2 |
| 번역 방식 | **방식 A (인라인 블록)** |
| 캐시 키 | 기사 URL + 제목 해시 |

##### 12-2. 기사 본문

| 항목 | 내용 |
|---|---|
| 위치 | 리치 텍스트 영역의 `<p>` 요소들 |
| 텍스트 특성 | 장문 — 단락 단위로 분할 |
| 번역 방식 | **방식 A (인라인 블록)** — **각 `<p>` 단락 아래에** 개별 번역 삽입 |
| 주의 | 전체를 한 번에 번역하면 안 됨 — 단락별로 분할하여 점진적 번역 |
| 캐시 키 | 기사 URL + 단락 인덱스 + 텍스트 해시 |

---

### 13. Spaces

**URL**: `/i/spaces/{space_id}`

Spaces는 오디오 방이므로 텍스트 콘텐츠가 제한적.

#### 번역 대상 요소

##### 13-1. 스페이스 타이틀 (타임라인 카드)

| 항목 | 내용 |
|---|---|
| 위치 | 타임라인에 Space 카드로 노출될 때 |
| 셀렉터 | Space 카드 내 제목 span |
| 번역 방식 | **방식 B (호버 툴팁)** |
| 캐시 키 | 제목 텍스트 |

##### 13-2. 호스트/스피커 이름

| 항목 | 내용 |
|---|---|
| 위치 | Space 오버레이 내 참가자 표시 |
| 번역 방식 | **방식 B (호버 툴팁)** |

##### 13-3. 스페이스 상세 페이지

| 항목 | 내용 |
|---|---|
| 위치 | Space 오버레이/전체 페이지 |
| 우선순위 | **낮음 (Phase 3)** — 독자적 UI, 사용 빈도 낮음 |

---

### 14. Topics 페이지

**URL**: `/i/topics/{topic_id}`, `/i/topics/picker`, `/{username}/topics`

#### 번역 대상 요소

##### 14-1. 토픽 타임라인

| 항목 | 내용 |
|---|---|
| 처리 | 1번(홈 타임라인)과 **완전 동일** |

##### 14-2. 토픽 이름 (토픽 피커)

| 항목 | 내용 |
|---|---|
| 위치 | 토픽 선택 UI의 각 토픽 칩/카드 |
| 번역 방식 | **방식 C (인라인 괄호)** 또는 **방식 B (호버 툴팁)** |
| 우선순위 | 낮음 (Phase 2) |

---

### 15. Moments/Events 페이지

**URL**: `/i/events/{event_id}`

#### 번역 대상 요소

##### 15-1. 이벤트 헤더

| 항목 | 내용 |
|---|---|
| 셀렉터 | `[data-testid="eventHero"]` 내 제목/설명 |
| 번역 방식 | **방식 A (인라인 블록)** |
| 캐시 키 | 이벤트 URL + 텍스트 해시 |

##### 15-2. 큐레이션 트윗

| 항목 | 내용 |
|---|---|
| 처리 | 1번(홈 타임라인)과 **완전 동일** |

---

### 16. Quote Tweets 페이지

**URL**: `/{username}/status/{tweet_id}/quotes`

#### 번역 대상 요소

| 항목 | 내용 |
|---|---|
| 구조 | 인용 트윗 목록 — `article[data-testid="tweet"]` |
| 처리 | 1번(홈 타임라인)과 **완전 동일** |

---

### 17. Retweets/Likes 목록 페이지

**URL**: `/{username}/status/{tweet_id}/retweets`, `/{username}/status/{tweet_id}/likes`

#### 번역 대상 요소

| 항목 | 내용 |
|---|---|
| 구조 | `[data-testid="UserCell"]` 목록 — 트윗 article 없음 |
| 처리 | 4번(팔로워/팔로잉)과 **완전 동일** — UserCell 구조 |

---

### 18. 사진/동영상 뷰어

**URL**: `/{username}/status/{tweet_id}/photo/{n}`, `/{username}/status/{tweet_id}/video/{n}`

모달 오버레이로 표시. 미디어 옆 사이드 패널에 트윗 + 답글이 표시됨.

#### 번역 대상 요소

##### 18-1. 사이드 패널 트윗 텍스트

| 항목 | 내용 |
|---|---|
| 셀렉터 | 모달 내 `[data-testid="tweetText"]` |
| 처리 | 1번과 **동일** — MutationObserver가 모달 내부도 감지 |

##### 18-2. 사이드 패널 답글

| 항목 | 내용 |
|---|---|
| 처리 | 1번과 **동일** |

주의: 모달은 `document.body` 직하에 추가되므로, MutationObserver가 `document.body`를 관찰하면 자동으로 감지됨.

---

### 19. 사이드바

**위치**: 대부분의 페이지 우측에 표시 (데스크톱)

**컨테이너 구조**:
```
div[data-testid="sidebarColumn"]
  ├── 검색바
  ├── 트렌딩 섹션 (aria-label="Timeline: Trending now")
  │     └── div[data-testid="trend"]  (반복)
  ├── "おすすめユーザー" 섹션
  │     └── div[data-testid="UserCell"]  (반복)
  └── 기타 프로모션/추천
```

#### 번역 대상 요소

##### 19-1. 트렌딩 토픽

| 항목 | 내용 |
|---|---|
| 처리 | 5-3(트렌딩 토픽)과 **동일** |

##### 19-2. 추천 유저 이름

| 항목 | 내용 |
|---|---|
| 처리 | 4-1(유저 표시명)과 **동일** — 호버 툴팁 |

##### 19-3. 추천 유저 바이오

| 항목 | 내용 |
|---|---|
| 셀렉터 | 사이드바 `[data-testid="UserCell"]` 내 바이오 |
| 번역 방식 | **방식 B (호버 툴팁)** — 사이드바는 공간이 좁아 인라인 블록 대신 툴팁 사용 |
| 캐시 키 | 바이오 텍스트 해시 |

---

## 번역 제외 대상

다음 요소들은 번역하지 않음:

| 카테고리 | 예시 | 이유 |
|---|---|---|
| **UI 탭 라벨** | ホーム, 通知, メッセージ, 話題を検索 | Twitter 자체 로컬라이제이션 |
| **UI 버튼** | いいね, リポスト, ブックマーク, 共有 | UI 텍스트 |
| **UI 메뉴** | 削除, ブロック, ミュート, 報告 | UI 텍스트 |
| **UI 라벨** | もっと見る, このスレッドを表示, 固定されたポスト | UI 텍스트 |
| **알림 템플릿** | ○○さんがいいねしました (템플릿 부분) | UI 텍스트 (이름 부분은 별도 처리) |
| **트윗 작성 영역** | tweetTextarea | 사용자 입력 중 |
| **숫자/카운트** | 참여 지표, 게시물 수 | 번역 불필요 |
| **인증 배지** | 認証済みアカウント | UI 텍스트 |
| **프로모션 라벨** | プロモーション | UI 텍스트 |
| **가입일** | 2020年4月からXを利用しています | UI 텍스트 |
| **팔로워/팔로잉 수** | NNフォロワー, NNフォロー中 | UI 텍스트 |
| **@handle** | @username | 번역 불가 |
| **URL** | https://... , t.co/... | 번역 불필요 |
| **설정 페이지** | /settings/* 전체 | UI 텍스트만 존재 |
| **로그인/가입** | /i/flow/* | UI 텍스트 |
| **분석/수익화** | /i/analytics, /i/monetization | UI 텍스트 |
| **Premium 페이지** | /i/premium_sign_up | UI 텍스트 |
| **키보드 단축키** | /i/keyboard_shortcuts | UI 텍스트 |
| **광고 관리** | ads.x.com | 별도 서브도메인, UI 텍스트 |

### 제외 판별 로직

UI 텍스트를 번역 대상에서 제외하는 방법:

1. **허용 목록 방식**: 번역할 `data-testid` 셀렉터를 명시적으로 지정하고, 목록에 없는 요소는 무시
2. `contenteditable="true"` 또는 `role="textbox"` 요소 제외 (작성 영역)
3. `data-testid="tweetTextarea"` 로 시작하는 요소 제외

---

## 구현 모듈 구조

```
src/content/twitter/
  ├── index.ts              ← Twitter 핸들러 진입점 (감지 + 초기화)
  ├── observer.ts           ← 공유 MutationObserver (하나만 사용)
  ├── tweet-handler.ts      ← 트윗 본문 + 카드 + 투표 + 커뮤니티노트
  ├── user-handler.ts       ← 유저명 + 바이오 + 위치 (프로필/유저셀/사이드바)
  ├── trend-handler.ts      ← 트렌딩 토픽
  ├── dm-handler.ts         ← DM 메시지 (옵션)
  ├── article-handler.ts    ← Articles 장문 (옵션)
  └── utils.ts              ← Twitter 전용 유틸 (캐시 키 추출, 셀렉터 상수 등)
```

### 감지 흐름

```
index.ts (Twitter 감지)
  │
  ├── hostname이 x.com 또는 twitter.com인지 확인
  ├── observer.ts 초기화 (document.body에 MutationObserver 1개)
  │
  └── MutationObserver callback
        │
        ├── addedNodes에서 셀렉터 매칭
        │     ├── [data-testid="tweetText"]     → tweet-handler
        │     ├── [data-testid="User-Name"]     → user-handler
        │     ├── [data-testid="UserName"]      → user-handler
        │     ├── [data-testid="UserDescription"]→ user-handler
        │     ├── [data-testid="UserLocation"]  → user-handler
        │     ├── [data-testid="UserCell"]      → user-handler
        │     ├── [data-testid="card.wrapper"]  → tweet-handler
        │     ├── [data-testid="trend"]         → trend-handler
        │     ├── [data-testid="socialContext"]  → user-handler (이름 부분)
        │     └── (DM/Article 관련)             → dm-handler / article-handler
        │
        └── 각 핸들러가 일본어 판별 → 번역 요청 → 결과 삽입
```

### 초기화 조건

기존 `index.ts`에서 YouTube 감지처럼 Twitter를 별도 분기:

```
const isTwitter = hostname === 'x.com' || hostname === 'twitter.com';
if (isTwitter) {
  initTwitterHandler();  // Twitter 전용 경로
} else if (isYouTube) {
  initYouTubeHandler();  // 기존 YouTube 경로
} else {
  initWebpageHandler();  // 기존 일반 웹페이지 경로
}
```

---

## 캐시 전략

### 캐시 키 체계

| 대상 | 캐시 키 | 이유 |
|---|---|---|
| 트윗 본문 | 트윗 URL (`/{user}/status/{id}`) | DOM 재생성에도 URL은 동일 |
| 인용 트윗 | 인용된 트윗 URL | 별도 URL 존재 |
| 유저 바이오 | `@handle` + 바이오 텍스트 해시 | 바이오 변경 시 재번역 |
| 유저명 | display name 텍스트 | 같은 이름은 같은 번역 |
| 해시태그 | 해시태그 텍스트 | 동일 태그는 재사용 |
| 트렌딩 토픽 | 토픽 텍스트 | 동일 토픽은 재사용 |
| 링크 카드 | 카드 URL | 동일 링크는 같은 OGP |
| 위치 | 위치 텍스트 | 동일 지명은 같은 번역 |
| DM 메시지 | 메시지 텍스트 해시 | URL 없으므로 텍스트 기반 |
| Article 단락 | 기사 URL + 단락 인덱스 | 단락 위치 기반 |

### 가상 스크롤 대응

Twitter의 가상 스크롤로 DOM이 재생성될 때:

1. 새 요소가 MutationObserver에 감지됨
2. 캐시 키 추출 (예: 트윗 URL)
3. 캐시 히트 → API 호출 없이 즉시 번역 블록 재삽입
4. 캐시 미스 → 번역 API 호출 후 캐시 저장 + 삽입

### 캐시 키 추출 방법

```
트윗 URL 추출:
  article[data-testid="tweet"]
    └── time 요소를 찾음
          └── 부모 <a>의 href → "/{user}/status/{id}"

인용 트윗 URL 추출:
  인용 카드(role="link") 내부의 time → 부모 <a> href

유저 @handle 추출:
  [data-testid="User-Name"] 내 "@"로 시작하는 span 텍스트
```

---

## 구현 우선순위

### Phase 1 (핵심)

- [ ] Twitter 감지 + 전용 경로 분기 (`index.ts`)
- [ ] 공유 MutationObserver (`observer.ts`)
- [ ] 트윗 본문 번역 (`tweet-handler.ts`) — `[data-testid="tweetText"]`
- [ ] 인용 트윗 지원
- [ ] 유저 바이오 번역 (`user-handler.ts`) — `[data-testid="UserDescription"]`
- [ ] 가상 스크롤 대응 캐시

### Phase 2 (확장)

- [ ] 유저 표시명 호버 툴팁 — `[data-testid="User-Name"]`
- [ ] 프로필 위치 호버 툴팁 — `[data-testid="UserLocation"]`
- [ ] 해시태그 호버 툴팁
- [ ] 트렌딩 토픽 인라인 괄호 — `[data-testid="trend"]`
- [ ] 링크 프리뷰 카드 번역 — `[data-testid="card.wrapper"]`
- [ ] 투표 옵션 인라인 괄호
- [ ] 리스트/커뮤니티 이름·설명
- [ ] UserCell 바이오 미리보기

### Phase 3 (옵션)

- [ ] DM 메시지 번역 (기본 OFF)
- [ ] Grok 응답 번역 (기본 OFF)
- [ ] Articles 장문 번역
- [ ] 이미지 ALT 텍스트
- [ ] 커뮤니티 노트
- [ ] Spaces 제목
- [ ] 토픽 피커
- [ ] 검색 자동완성
