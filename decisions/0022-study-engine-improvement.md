# 0022: 학습 엔진 Anki 수준 개선 + 랜덤 릴레이

## 상태: 진행중

## 맥락

현재 학습 화면은 카드를 한 번 보고 넘어가는 단순 구조. Anki의 핵심인 learning steps(세션 내 반복), 간격 표시, 카운트 표시가 없어 학습 효과가 떨어짐. SRS와 별개로 날짜 범위 기반 무한 랜덤 릴레이 모드 필요.

## 결정 사항

- **힌트 시스템**: 앞면에 [발음 보기] [예문 보기] 버튼 제공, 카드 전환 시 매번 리셋
- **인터리빙**: learning 카드를 review/new 사이에 끼움 (Anki 방식)
- **엔진**: 순수 함수 + useReducer (DB 의존 없는 세션 로직)
- **릴레이 소스**: 날짜 범위만 (복습 카드 릴레이 제외 → SRS 동기 약화 방지)
- **예문**: 정답 공개 시 즉시 표시 (접힘 없음)
- **모드 전환**: 카드형 선택 화면 ("오늘의 학습" / "자유 복습")
- **타이머**: 동적 setTimeout (waitingQueue[0].dueAt 기준)
- **카운트 바**: 앱 팔레트 색상 + N/L/R 약자 병행

## 주요 변경

1. DB schema에 learning_steps 컬럼 추가
2. DriveCardState에 learning_steps 추가 (하위호환)
3. FSRS에 computeReview/getSchedulingPreview/formatInterval 순수 함수 추가
4. JOIN 쿼리로 N+1 해소, 날짜 범위 랜덤 쿼리 추가
5. study-session.ts: 순수 함수 기반 SRS 세션 엔진
6. StudyCard: 공유 카드 UI 컴포넌트
7. SrsSession: useReducer 기반 SRS 컨테이너
8. RelaySession: 날짜 범위 랜덤 릴레이
9. study.tsx: 모드 선택 thin shell

## 대안

- 1초 폴링 타이머 → 불필요한 리렌더링 ⟶ 동적 setTimeout 선택
- 세그먼트 컨트롤 모드 전환 → 정보량 부족 ⟶ 카드형 선택 화면 선택
- 복습 카드 릴레이 → SRS 스케줄 무력화 ⟶ 날짜 범위 릴레이만 선택
