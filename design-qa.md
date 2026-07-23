# 내 작업 목록 구조 Design QA

- Source visual truth: `/var/folders/0g/9ftcl3zs36sd93n_k505ygsm0000gn/T/codex-clipboard-cb09746d-bfa2-4e38-9d56-e1aa0546afc3.png`
- Implementation screenshot: `/private/tmp/rivet-my-work-row-implementation.png`
- Viewport: 1792 × 1706 CSS px, desktop dark theme
- State: 내 작업 전체 보기, comfortable density, 작업 1개

## Findings

- 이슈 목록의 헤더 없는 행 구조를 따라 `작업 식별 정보 · 상태 · 완료 행동` 3영역으로 정리했다.
- 작업 ID와 제목을 한 줄에 두고, 프로젝트·팀·라벨을 그 아래 보조 정보로 묶어 시선 흐름을 단순화했다.
- 중복되던 상위 이슈 ID와 팀 키는 제거했으며, 우선순위는 아이콘만 유지했다.
- 제목 옆 개수는 제거하고 목록 하단의 `총 1개`로 옮겨 이슈 목록과 동일한 마감 방식을 적용했다.
- comfortable과 compact 모두 정보 순서, 정렬, 완료 행동이 유지되며 가로 오버플로는 확인되지 않았다.

## Interaction verification

- 작업 행의 상세 링크, 상태 변경 컨트롤, 완료 버튼이 기존 역할과 경로를 유지하는 것을 확인했다.
- comfortable 및 compact 밀도에서 작업 ID, 프로젝트, 팀, 라벨과 총 개수를 확인했다.

final result: passed

---

# 저장 보기 액션 Design QA

- Source visual truth: `/var/folders/0g/9ftcl3zs36sd93n_k505ygsm0000gn/T/codex-clipboard-141a157f-5464-43d3-9c9d-a584aeb34749.png`
- Implementation screenshot: `/private/tmp/rivet-save-action-implementation.png`
- Combined comparison: `/private/tmp/rivet-save-action-comparison.png`
- Viewport: 1792 × 1706 CSS px, desktop dark theme
- Source pixels: 2956 × 1096
- Implementation pixels: 1792 × 1706
- Normalization: source was resized to 1400 × 519. The implementation main content was cropped from x=240, y=0 at 1552 × 575 and resized to 1400 × 519.
- State: compact density, saved view selected, unsaved view changes present

## Full-view comparison evidence

The original detached action row has been removed. The active view now owns the unsaved indicator, management menu, and primary save action on the same row. The list starts immediately below the view controls without the extra action-row gap.

## Focused region comparison evidence

The normalized comparison clearly shows the complete view-control region and the first five rows, so a separate close crop was not needed. The save button, active-view indicator, overflow menu, toolbar alignment, divider, and list start are all readable in the combined image.

## Findings

- No actionable P0, P1, or P2 differences remain for the selected save-action layout.
- Typography, colors, icons, row density, and existing image assets are unchanged.
- The small primary save button is visually subordinate to the page while remaining distinguishable from the view-management icon.
- Copy is reduced from four simultaneous actions to one visible `저장` action. `초기화` and `새 보기로 저장` remain available in the management menu.

## Interaction verification

- Confirmed that the dirty saved view exposes `저장` next to the active view.
- Confirmed that the management popover exposes `초기화` and `새 보기로 저장`.
- Component test confirms that saving updates the currently selected view.

## Comparison history

1. Earlier finding: the detached `변경됨 · 초기화 · 새 보기로 저장 · 변경 저장` row weakened ownership and pushed the list downward.
2. Fix: moved the primary save action beside the active view and moved secondary actions into its management menu.
3. Post-fix evidence: `/private/tmp/rivet-save-action-comparison.png` shows the secondary row removed and the save action attached to the active view.

final result: passed

---

## 이전 QA 기록: 프로젝트 메뉴

- source visual truth path: `/var/folders/0g/9ftcl3zs36sd93n_k505ygsm0000gn/T/codex-clipboard-9fcae720-a955-45b8-935a-04e6f2d76f93.png`
- implementation screenshot path: `/Users/kim/.codex/visualizations/2026/07/21/019f8201-2340-7f10-8093-cc902106cd20/project-menu-after.png`
- viewport: source crop 952×392 at 2x density; implementation content crop 1152×392 at 1x density
- state: 다크 테마, 이슈가 연결된 활성 프로젝트, 프로젝트 더보기 메뉴 열림
- browser-rendered URL: `http://127.0.0.1:3000/projects/d73b3baf-654a-4202-8e33-c780f7615839`

### Evidence

- full-view comparison: `/Users/kim/.codex/visualizations/2026/07/21/019f8201-2340-7f10-8093-cc902106cd20/project-menu-comparison.png`
  - 원본과 구현 캡처의 밀도와 가로 크기가 달라 전체 화면은 구성과 상태 확인에 사용했다.
  - 상단의 독립 편집 버튼이 사라지고 더보기와 이슈 만들기만 남은 점을 확인했다.
- focused region comparison: `/Users/kim/.codex/visualizations/2026/07/21/019f8201-2340-7f10-8093-cc902106cd20/project-menu-focused-comparison.png`
  - 원본 메뉴를 2x에서 1x로 정규화해 구현 메뉴와 나란히 비교했다.
  - 제목 블록, 구분선, 편집, 보관 순서와 240px 메뉴 폭을 확인했다.

### Findings

- P0/P1/P2: 없음.
- fonts and typography: 기존 Pretendard 계열과 프로젝트 타이포그래피를 유지했다. 보조 라벨은 12px, 제목과 액션은 14px 계층으로 구분되며 긴 프로젝트명은 말줄임 처리된다.
- spacing and layout rhythm: 제목 블록의 8px 내부 간격과 구분선 뒤 액션 간격이 일관적이다. 메뉴는 `clientWidth = scrollWidth = 240`, `clientHeight = scrollHeight = 147`로 오버플로가 없다.
- colors and visual tokens: `bg-muted`, `text-muted-foreground`, `border` 토큰으로 기존 다크 테마 대비를 유지했다. 임의 색상은 추가하지 않았다.
- image quality and asset fidelity: 이 화면에는 래스터 이미지가 없다. 폴더, 편집, 보관 아이콘은 프로젝트가 이미 사용하는 Lucide 아이콘을 사용해 선 굵기와 스타일이 일치한다.
- copy and content: `프로젝트` 보조 라벨, 실제 프로젝트명, `프로젝트 편집`, `프로젝트 보관`이 의도한 정보와 작업 순서를 정확히 전달한다.

### Primary Interactions Tested

- `프로젝트 더보기`를 열어 제목 블록, 구분선, 편집·보관 액션 노출을 확인했다.
- `프로젝트 편집` 링크가 현재 프로젝트의 `/edit` 경로를 가리키는지 확인했다.
- 브라우저 콘솔 오류는 없었다.

### Comparison History

#### Pass 1

- earlier findings: 없음.
- fixes made: QA 비교 후 추가 수정 없음.
- post-fix visual evidence: focused region comparison에서 액션 이동과 제목 구분이 의도대로 확인되었다.

### Implementation Checklist

- [x] 상단의 독립 편집 버튼 제거
- [x] 편집을 더보기 메뉴의 첫 액션으로 이동
- [x] 제목을 보조 라벨, 프로젝트명, 폴더 아이콘으로 구분
- [x] 제목과 액션 사이에 구분선 추가
- [x] 편집 링크와 보관 동작 유지
- [x] 메뉴 오버플로와 콘솔 오류 확인

final result: passed
