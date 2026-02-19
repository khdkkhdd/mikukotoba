# 기술 명세 정확성 점검 및 일괄 수정

Status: accepted
Date: 2026-02-19

## Context

리팩토링 착수 전, 5개 기술 명세(번역 공통, 웹페이지, 유튜브, 트위터, 단어장)를 feature spec 및 실제 소스코드와 대조 점검했다. 기술 명세가 코드와 불일치하거나 feature spec과 모순되는 항목이 다수 발견되었고, 개발자가 기술 명세만으로 구현하기에 부족한 누락 섹션도 확인되었다.

## Decision

5개 기술 명세를 소스코드 기준으로 일괄 수정하고, 누락된 공통 인프라 섹션을 추가한다.

### 수정 원칙
1. **코드가 진실**: 기술 명세와 코드가 다르면 코드에 맞춰 명세를 수정한다.
2. **feature spec과의 모순은 명시**: 코드가 feature spec과 다른 경우, 기술 명세에 현재 상태와 차이를 명시하고 개선 방향을 기술한다 (feature spec을 수정하지 않음).
3. **공통 인프라는 공통 명세에**: 설정 저장, 렌더러, 핸들러 레지스트리 등 사이트 공통 모듈은 `translation_common_tech.md`에 추가한다.

### 주요 수정 내역
- **데이터 불일치 7건** (Papago 엔드포인트, 복잡도 범위 0~10, LLMClient 시그니처, GlossaryEntry 필드명, 캐시 크기, 컨텍스트 기본값, TranslationResult 필드명)
- **feature spec 모순 명시** (웹페이지 4건, 트위터 furigana-only 모드, 유튜브 단어 클릭 버그)
- **누락 섹션 추가** (설정 저장 아키텍처, 사용 통계, 공유 렌더러 계층, 핸들러 레지스트리, 키보드 단축키, 캐시 전략, 다크 모드, SPA 네비게이션, 동시성 제어, 메시지 프로토콜)

## Consequences

### Positive
- 개발자가 기술 명세만으로 구현 가능한 수준으로 정보 밀도 향상
- 코드 ↔ 명세 ↔ feature spec 간 불일치 해소 (또는 명시적 기록)
- 공유 모듈의 경계와 인터페이스가 명확해져 사이트별 핸들러 구현 시 참조 가능

### Negative
- 기술 명세 분량이 증가하여 유지보수 부담 상승
- 코드 변경 시 기술 명세도 함께 업데이트해야 하는 이중 관리 필요
- feature spec과의 모순 일부는 "현재 상태 명시"로 처리했으므로, 코드 수정 또는 feature spec 수정이 별도로 필요

## Alternatives Considered

- **feature spec을 코드에 맞춰 수정**: feature spec은 사용자 관점이므로 "있어야 할 동작"을 기술하는 것이 맞다. 코드에 맞춰 하향하면 목표를 잃게 됨. 기각.
- **기술 명세를 폐기하고 코드 주석으로 대체**: 파이프라인 흐름, 모듈 간 관계, 설계 근거 등은 코드 주석으로 담기 어려움. 기각.
- **각 불일치를 개별 이슈로 분리 처리**: 수십 건의 소규모 수정을 개별 관리하면 오버헤드가 큼. 일괄 수정이 효율적. 기각.

## References

- Plan: N/A
- Related: `docs/tech/translation_common_tech.md`, `docs/tech/webpage_tech.md`, `docs/tech/youtube_tech.md`, `docs/tech/twitter_tech.md`, `docs/tech/vocab_tech.md`
