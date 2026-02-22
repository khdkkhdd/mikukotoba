# 4단계 파이프라인으로 후리가나 읽기 정확도 개선

Status: accepted
Date: 2026-02-22

## Context

kuromoji v0.1.2 + IPAdic(2007) 사전으로 후리가나를 생성 중인데 두 가지 문제가 있었다: (1) 다독음 한자(今日, 一人, 下手 등)에서 문맥에 맞지 않는 읽기 선택, (2) 2007년 이후 신조어·고유명사 미인식. IPAdic 자체는 업데이트가 중단되어 사전 교체만으로는 해결 불가.

## Decision

사전 확장 + 후처리 보정을 4단계 파이프라인으로 구현한다:

- **P1**: IPAdic + NEologd 350K 엔트리로 사전 재빌드 (신조어 인식)
- **P2**: 정적 오버라이드 — `surface + kuromojiReading → correctReading` 매핑 (단일 토큰 오독 교정)
- **P3**: 문맥 규칙 — 인접 토큰의 POS/surface를 보고 다독음 해소 (一+人→ひとり 등)
- **P4**: 선별적 LLM 보정 — P1~P3 미해결 다독음 한자만 LLM에 검증 요청 (캐시 90일)

P2·P3는 `morphological.ts`의 `analyze()` 내 동기 실행, P4는 `translator/index.ts`의 `doTranslate()` 내 비동기 실행.

## Consequences

### Positive
- 단계별 독립성: 각 단계가 이전 단계의 결과를 개선하며 단독 비활성화 가능
- P2의 안전장치: kuromojiReading 매칭 필수 → 이미 맞는 결과를 건드리지 않음 (false positive 0)
- P4 비용 제어: 다독음 한자 없으면 LLM 호출 0, 캐시 히트시 0, 호출 시 ~70토큰
- NEologd 350K 엔트리로 고유명사 인식 대폭 개선

### Negative
- 사전 크기 증가: 17MB → 30MB (Chrome extension 배포 크기 증가)
- P2·P3 규칙은 수동 관리 필요 (자동 학습 아님)
- P4 LLM 호출은 네트워크 지연 추가 (캐시 미스 시)
- NEologd seed는 2020년 고정 — 이후 신조어는 포함 안 됨

## Alternatives Considered

- **NEologd 전체 포함 (3.2M 엔트리)**: 198MB로 Chrome extension에 부적합. 카오모지·해시태그 등 노이즈가 대부분.
- **사전 교체 없이 LLM만 사용**: 모든 한자 단어에 LLM 호출 필요 → 비용/지연 과다. 대부분의 읽기는 사전+규칙으로 해결 가능.
- **UniDic 사전으로 교체**: kuromoji가 IPAdic 형식만 지원. UniDic은 형식이 다르고 kuromoji와 호환 불가.
- **단일 LLM 전처리 (문장 전체 읽기 생성)**: 매 문장마다 LLM 호출 필수 → 비용 높고 오프라인 불가. 선별적 호출(P4)이 비용 효율적.

## References

- Plan: context.md
- Related: `tools/build-dict.mjs`, `src/core/analyzer/reading-overrides.ts`, `src/core/analyzer/reading-context-rules.ts`, `src/core/analyzer/reading-llm-corrector.ts`
