# 통합 아키텍처 문서 완성: 교차 관심사 7절 구조와 5-Phase 리팩토링 계획

Status: accepted
Date: 2026-02-19

## Context

5개 기능 명세 + 5개 기술 명세가 완성되었으나, 개별 명세에서 다루지 않는 교차 관심사(모듈 간 중복, 렌더링 비일관성, 판별 전략 분기)가 정리되지 않아 리팩토링 시작점이 불명확했다. decision 0008에서 교차 관심사 중심 범위를 결정했고, 이에 따라 `docs/tech/integration_architecture.md`를 작성했다.

## Decision

7절 구조의 통합 아키텍처 문서를 완성하고, 이를 리팩토링 로드맵으로 사용한다.

**문서 구조**:
1. 모듈 의존성 구조 — 3-계층 다이어그램, Shared 모듈 사용 매트릭스, 구조적 중복 3건 식별
2. 렌더링 모드 통합 설계 — 3모드 × 4핸들러 매트릭스, 후리가나 3방식 비교, 스포일러 비일관성
3. 일본어 판별 전략 분기 — 5가지 전략 비교, 통합 방향(공유 유틸 정비 + 사이트별 config 유지)
4. 메시지 통신과 설정 전파 — 전체 흐름도, YouTube MAIN world 브릿지
5. 공유 모듈 조합과 사이트별 차이 — DOM 감지 3패턴, 뷰포트·배치·SPA·동시성 비교
6. 설정 전파와 핸들러 재시작 — 동일 코드 복사 지적, CSS 변수 실시간 반영
7. 리팩토링 5-Phase 계획 — 공유 인프라 → 렌더링 통합 → 판별·성능 → 단어장 연동 → 번역 파이프라인

**핵심 발견 5건**:
- DOM 감지 3중 구현 (TwitterObserver / BatchedObserver / TextDetector)
- ProcessedTracker Webpage 미적용
- 재시작 조건 3중 복사
- Webpage 렌더링 비일관성 (스포일러 미적용, 자체 div 조립, 파괴적 후리가나)
- HoverPopup 불필요 래퍼

**검증**: 모든 모듈 경로(34개)와 함수/클래스 참조(34개)를 소스코드와 대조하여 전수 확인 완료.

## Consequences

### Positive
- 11개 문서(기능 5 + 기술 5 + 통합 1)로 리팩토링 착수 가능 상태 달성
- Phase별 의존성 순서가 명확하여 병렬 작업 가능 범위가 드러남
- 교차 관심사가 개별 명세와 중복 없이 한 곳에 정리됨

### Negative
- 문서가 현재 코드 스냅샷 기반이므로, 리팩토링 진행 중 문서 동기화 필요
- Phase 3~5는 코드 변경 경험이 축적된 후 구체화해야 할 수 있음

## Alternatives Considered

- **바로 리팩토링 착수**: 기술 명세만으로 충분하다고 보고 통합 문서 없이 시작. 사이트 간 공유 모듈 경계가 불명확한 상태에서 일관성 저하 위험으로 기각.
- **리팩토링 계획만 별도 작성**: 교차 관심사 분석 없이 액션 아이템 체크리스트만 작성. 왜 그 순서인지 근거가 부족하여 기각.

## References

- Plan: context.md
- Related: decisions/0008-integration-architecture-scope.md
- Related: docs/tech/integration_architecture.md
