# Design QA

- source visual truth path: `/var/folders/0g/9ftcl3zs36sd93n_k505ygsm0000gn/T/codex-clipboard-9fcae720-a955-45b8-935a-04e6f2d76f93.png`
- implementation screenshot path: `/Users/kim/.codex/visualizations/2026/07/21/019f8201-2340-7f10-8093-cc902106cd20/project-menu-after.png`
- viewport: source crop 952×392 at 2x density; implementation content crop 1152×392 at 1x density
- state: 다크 테마, 이슈가 연결된 활성 프로젝트, 프로젝트 더보기 메뉴 열림
- browser-rendered URL: `http://127.0.0.1:3000/projects/d73b3baf-654a-4202-8e33-c780f7615839`

## Evidence

- full-view comparison: `/Users/kim/.codex/visualizations/2026/07/21/019f8201-2340-7f10-8093-cc902106cd20/project-menu-comparison.png`
  - 원본과 구현 캡처의 밀도와 가로 크기가 달라 전체 화면은 구성과 상태 확인에 사용했다.
  - 상단의 독립 편집 버튼이 사라지고 더보기와 이슈 만들기만 남은 점을 확인했다.
- focused region comparison: `/Users/kim/.codex/visualizations/2026/07/21/019f8201-2340-7f10-8093-cc902106cd20/project-menu-focused-comparison.png`
  - 원본 메뉴를 2x에서 1x로 정규화해 구현 메뉴와 나란히 비교했다.
  - 제목 블록, 구분선, 편집, 보관 순서와 240px 메뉴 폭을 확인했다.

## Findings

- P0/P1/P2: 없음.
- fonts and typography: 기존 Pretendard 계열과 프로젝트 타이포그래피를 유지했다. 보조 라벨은 12px, 제목과 액션은 14px 계층으로 구분되며 긴 프로젝트명은 말줄임 처리된다.
- spacing and layout rhythm: 제목 블록의 8px 내부 간격과 구분선 뒤 액션 간격이 일관적이다. 메뉴는 `clientWidth = scrollWidth = 240`, `clientHeight = scrollHeight = 147`로 오버플로가 없다.
- colors and visual tokens: `bg-muted`, `text-muted-foreground`, `border` 토큰으로 기존 다크 테마 대비를 유지했다. 임의 색상은 추가하지 않았다.
- image quality and asset fidelity: 이 화면에는 래스터 이미지가 없다. 폴더, 편집, 보관 아이콘은 프로젝트가 이미 사용하는 Lucide 아이콘을 사용해 선 굵기와 스타일이 일치한다.
- copy and content: `프로젝트` 보조 라벨, 실제 프로젝트명, `프로젝트 편집`, `프로젝트 보관`이 의도한 정보와 작업 순서를 정확히 전달한다.

## Primary Interactions Tested

- `프로젝트 더보기`를 열어 제목 블록, 구분선, 편집·보관 액션 노출을 확인했다.
- `프로젝트 편집` 링크가 현재 프로젝트의 `/edit` 경로를 가리키는지 확인했다.
- 브라우저 콘솔 오류는 없었다.

## Comparison History

### Pass 1

- earlier findings: 없음.
- fixes made: QA 비교 후 추가 수정 없음.
- post-fix visual evidence: focused region comparison에서 액션 이동과 제목 구분이 의도대로 확인되었다.

## Implementation Checklist

- [x] 상단의 독립 편집 버튼 제거
- [x] 편집을 더보기 메뉴의 첫 액션으로 이동
- [x] 제목을 보조 라벨, 프로젝트명, 폴더 아이콘으로 구분
- [x] 제목과 액션 사이에 구분선 추가
- [x] 편집 링크와 보관 동작 유지
- [x] 메뉴 오버플로와 콘솔 오류 확인

final result: passed
