# UserCell 후리가나: 팔로우 추천 페이지 지원 + 이름 후리가나

Status: accepted
Date: 2026-02-22

## Context

트위터 팔로우 추천 페이지(`/i/connect_people`)와 사이드바 팔로우 추천 영역에서 `data-testid="UserCell"` 요소가 처리되지만, 바이오 텍스트를 찾지 못하고 이름에 후리가나가 적용되지 않는 문제가 있었다. 바이오 셀렉터가 실제 DOM 구조와 맞지 않았고, 이름은 hover target만 등록하고 후리가나 처리를 하지 않았다.

## Decision

`processUserCell`의 두 가지 로직을 수정:

1. **바이오 찾기**: `:scope > div > div` → `div[dir="auto"]`로 변경. 트위터 바이오는 항상 `dir="auto"` 속성을 사용하고, 이름/핸들은 `dir="ltr"`, 숨겨진 aria 설명은 `display:none`(빈 innerText)이라 자연스럽게 필터링됨.

2. **이름 후리가나**: `showFurigana` 활성화 시 `processHoverWithFurigana()`를 호출하여 루비 클론 생성. 클론에 hover target도 등록되어 후리가나와 호버 번역이 모두 동작.

3. **바이오 hover+furigana**: hover 모드에서도 `showFurigana` 활성화 시 `processHoverWithFurigana()`를 호출하도록 수정 (기존에는 hover target만 등록).

## Consequences

### Positive
- 팔로우 추천 페이지, 사이드바, 팔로워/팔로잉 목록에서 일본어 바이오와 이름에 후리가나 표시
- `processUserDescription`과 동일한 hover+furigana 패턴을 재사용하여 일관성 확보
- `div[dir="auto"]` 셀렉터가 DOM 깊이에 무관하게 동작하여 다양한 UserCell 레이아웃에 대응

### Negative
- `div[dir="auto"]`가 트위터 구조 변경 시 다른 요소와 매칭될 가능성 (낮음)
- 이름 후리가나 처리 시 추가 번역 API 호출 발생

## Alternatives Considered

- **`:scope > div > div > div`로 깊이 확장**: 특정 깊이에 의존하여 레이아웃 변경에 취약. Rejected.
- **`overflow: hidden` 스타일 체크로 바이오 식별**: inline style에 의존하여 불안정. Rejected.

## References

- Plan: N/A
- Related: `packages/extension/src/content/twitter/user-handler.ts`
