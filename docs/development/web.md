# 웹 개발 지침

> 상태: 확정 v1.0  
> 적용 범위: `apps/web`

웹 코드를 구현·리뷰·리팩터링할 때 [공통 개발 지침](./common.md)과 함께 읽는다.

## 1. 기본 구조

Next.js App Router의 [프로젝트 구조 규칙](https://nextjs.org/docs/app/getting-started/project-structure)을 따르고 `app`에는 라우팅과 화면 조합만 둔다.

```text
apps/web/
├── app/
│   ├── [locale]/
│   │   ├── (auth)/
│   │   ├── (workspace)/
│   │   ├── layout.tsx
│   │   ├── loading.tsx
│   │   └── error.tsx
│   └── globals.css
├── components/
│   ├── ui/          # shadcn/ui 원본을 Rivet 토큰에 맞춘 primitive
│   └── layout/      # 앱 셸, 탐색, 패널처럼 도메인과 무관한 구조
├── features/
│   ├── auth/
│   ├── issues/
│   ├── projects/
│   ├── teams/
│   ├── notifications/
│   ├── search/
│   └── settings/
├── lib/
│   ├── api/
│   ├── auth/
│   ├── realtime/
│   └── utils/
└── e2e/
```

- 웹은 `src/` 폴더를 추가하지 않고 `apps/web` 바로 아래에 소스 폴더를 둔다.
- URL과 layout 경계를 표현할 때만 route group을 사용한다.
- `app` 아래의 `page.tsx`와 `layout.tsx`는 기능 컴포넌트를 조합하고 복잡한 제품 규칙을 직접 구현하지 않는다.
- 기능 전용 컴포넌트, API hook과 화면 모델은 `features/<feature>`에 둔다.
- 두 기능에서 실제로 사용하는 앱 셸·표시 컴포넌트만 `components`로 올린다.
- `components/common`, `lib/helpers.ts`, `lib/utils.ts` 같은 잡동사니 폴더·파일을 만들지 않는다. `lib/utils`에는 `cn`처럼 도메인이 없는 짧은 기반 함수만 둔다.
- 작은 기능은 한 폴더에 파일을 평평하게 두고, 파일 수가 늘 때만 `components`, `api`, `model` 하위 폴더로 나눈다.

## 2. 컴포넌트와 상태 경계

- Server Component를 기본으로 두고 상태, 이벤트, 브라우저 API가 필요한 가장 작은 경계에만 `'use client'`를 선언한다.
- 제품 변경은 NestJS API 계약을 사용하며 Server Action이나 웹 `route.ts`에 별도 업무 쓰기 경로를 만들지 않는다.
- 브라우저 서버 상태는 TanStack Query를 유일한 캐시 계층으로 사용한다.
- query와 mutation은 `packages/api-client`에서 Orval이 생성한 Fetch 함수와 TanStack Query Hook을 사용한다.
- Orval이 생성한 Query Key를 캐시 식별의 기준으로 사용하고, 기능별 무효화·낙관적 갱신·롤백은 기능 폴더의 `api`에서 조합한다.
- 페이지와 컴포넌트에서 임의 `fetch` URL을 직접 조합하지 않는다.
- 화면 로컬 상태, 서버 상태와 URL 상태를 구분한다.
  - 모달 열림과 현재 입력값은 로컬 상태로 관리한다.
  - 이슈·프로젝트·알림은 서버 상태 캐시로 관리한다.
  - 검색어, 필터, 정렬과 선택 탭은 공유·복원할 필요가 있으면 URL 상태로 관리한다.
- MVP에는 Zustand, Redux 같은 별도 전역 상태 라이브러리를 도입하지 않는다.
- 페이지 이동 뒤에도 유지돼야 하고 서로 떨어진 여러 화면이 함께 변경하는 클라이언트 전용 상태가 실제로 생길 때만 해당 상태 범위에 전역 store 도입을 검토한다.
- props나 현재 state로 계산 가능한 값은 별도 state와 `useEffect`로 동기화하지 않는다.
- 컴포넌트 안에 새 컴포넌트를 선언하지 않는다. 동일 파일의 바깥 함수로 분리하고 필요한 값은 props로 전달한다.
- 서로 독립적인 요청은 순차 await하지 않고 함께 시작한다.
- Server Component에서 Client Component로는 실제 화면에서 사용하는 필드만 전달한다.
- 서버 렌더링 중 사용자별 값을 module scope의 변경 가능한 변수에 저장하지 않는다.
- `memo`, virtualization과 dynamic import는 측정된 렌더링·번들 문제나 명확한 대형 컴포넌트가 있을 때 추가한다.

## 3. 폼과 입력 검증

- 일반 폼 상태는 React Hook Form으로 관리하고 프론트 입력 검증은 Zod 스키마로 정의한다.
- Zod 스키마와 폼 값 타입은 사용하는 기능의 `model`에 두고 API DTO나 Prisma 모델과 공유하지 않는다.
- 폼 값은 제출 시 Orval이 생성한 요청 타입으로 명시적으로 변환한다.
- 프론트 검증은 빠른 피드백을 위한 것이며 API의 DTO·제품 규칙 검증을 대체하지 않는다.
- API의 `fieldErrors`는 React Hook Form의 필드 오류로 연결하고 필드에 속하지 않는 오류는 폼 단위로 표시한다.
- 기본 HTML 입력은 `register`를 우선하고 Lexical, 파일 선택기처럼 제어형 인터페이스가 필요한 컴포넌트에만 `Controller`를 사용한다.
- 서버에서 받은 초기값은 `defaultValues`와 명시적인 `reset`으로 적용하고 필드마다 `useEffect`로 동기화하지 않는다.
- 폼 상태를 TanStack Query 캐시나 전역 store에 중복 저장하지 않는다.

## 4. 기능 폴더

예시는 기준이며 사용하지 않는 하위 폴더는 만들지 않는다.

```text
features/issues/
├── api/
│   ├── issue-queries.ts
│   └── issue-mutations.ts
├── components/
│   ├── issue-list.tsx
│   ├── issue-detail.tsx
│   └── issue-form.tsx
├── model/
│   └── issue-form.ts
└── use-issue-realtime.ts
```

- `api`는 생성 클라이언트 호출, 캐시 키, 무효화와 낙관적 갱신을 모은다.
- `model`은 화면 전용 변환·검증만 두며 API DTO나 Prisma 모델을 복제하지 않는다.
- 한 기능이 다른 기능 UI를 필요로 하면 상위 페이지에서 조합하는 것을 우선한다.
- 두 기능이 서로 import해야 한다면 실제 공통 개념인지, 페이지 조합으로 해결할 수 있는지 먼저 확인한다.

## 5. UI와 스타일

- UI 시각 구현은 [DESIGN.md](../../DESIGN.md)와 [디자인 시스템 명세서](../planning/005.%20디자인%20시스템%20명세서.md)를 따른다.
- shadcn/ui 원본은 `apps/web/components/ui`에서 소유하고 제품 토큰과 접근성 기준에 맞게 수정한다.
- `packages/ui`는 두 번째 실제 소비자가 생기기 전에는 만들지 않는다.
- Tailwind는 `app/globals.css`의 의미 CSS 변수와 디자인 시스템 토큰을 사용한다.
- 컴포넌트에 임의 hex, 반복되는 arbitrary px와 임의 z-index를 추가하지 않는다.
- 조건부 class 결합은 기존 `cn`을 사용하고 단순 문자열을 위한 새 wrapper를 만들지 않는다.
- shadcn/ui가 사용하는 variant 도구가 있으면 그대로 사용하고 별도 variant 시스템을 추가하지 않는다.
- 아이콘은 `lucide-react`로 통일한다. 아이콘 단독 버튼에는 한국어 접근 가능 이름을 제공한다.
- 로딩, 빈 상태, 실패, 권한 없음과 충돌 상태를 성공 화면과 함께 구현한다.
- 클릭 가능한 `div`보다 올바른 `button`, `a`, `input`과 label을 사용한다.
- 키보드 포커스, ESC 닫기, 포커스 복귀와 모바일 터치 영역을 컴포넌트 완료 조건에 포함한다.

## 6. Lexical과 파일

- 설명, 댓글과 작업 전달은 하나의 공통 Lexical 구성을 재사용한다.
- 서버 정본은 Markdown 문자열이며 Lexical JSON과 렌더링 HTML을 API로 보내지 않는다.
- Markdown 미리보기와 저장 후 조회는 react-markdown, remark-gfm과 rehype-sanitize로 구성한 하나의 렌더러를 재사용한다.
- `rehype-raw`와 `dangerouslySetInnerHTML`을 사용하지 않고 Markdown 안의 HTML 원문은 렌더링하지 않는다.
- rehype-sanitize 허용 목록에는 MVP 서식에 포함된 요소와 속성만 두고 표·작업 목록·임의 HTML은 허용하지 않는다.
- 사용자 입력을 해석하거나 노드를 추가하는 plugin은 sanitize보다 앞에 실행하고 sanitize 뒤에는 신뢰된 표시 변환만 둔다.
- 링크와 이미지는 전용 React 컴포넌트에서 허용 프로토콜, 외부 링크 속성과 인증된 첨부파일 상대 경로를 검증한다.
- Data URL을 본문에 넣지 않고 업로드된 파일 ID의 같은 출처 상대 경로만 삽입한다.
- 붙여넣기 이미지 최적화는 사용자 경험 처리이며 API의 25MB·형식·권한 검증을 대체하지 않는다.
- 미리보기와 저장 후 조회는 같은 Markdown 렌더러와 허용 목록을 사용한다.
- 에디터 plugin은 command 처리, 이미지 업로드, 멘션처럼 독립 수명주기가 있을 때만 분리한다.

## 7. 국제화

- next-intl을 사용하고 초기 지원 locale은 `ko` 하나로 시작한다.
- 라우트는 내부적으로 `app/[locale]/...` 아래에 두고 `localePrefix: 'as-needed'`를 사용한다.
- 기본 한국어 URL에는 `/ko`를 붙이지 않고 향후 추가 locale만 `/en/...`처럼 접두사를 사용한다.
- 링크와 이동은 next-intl이 생성한 navigation API를 사용하고 경로에 locale 문자열을 직접 이어 붙이지 않는다.
- 메뉴, 버튼, 안내, 검증 오류와 접근 가능 이름을 포함한 사용자 노출 문구는 기능별 메시지 namespace에서 관리한다.
- 문장을 문자열 조각으로 이어 붙이지 않고 변수·복수형·날짜·숫자는 next-intl의 메시지와 formatter를 사용한다.
- API의 영문 오류 code를 메시지 key에 매핑하고 서버의 `message` 문자열을 그대로 사용자에게 표시하지 않는다.
- 데이터베이스에는 번역된 UI 문구를 저장하지 않는다. 사용자가 작성한 제목·설명·댓글은 번역 대상이 아니며 원문을 그대로 표시한다.
- Server Component에서 필요한 메시지만 읽고 전체 메시지 사전을 불필요하게 Client Component에 전달하지 않는다.
- 메시지 key를 화면에 직접 노출하거나 누락 시 임의 영문 문구로 조용히 대체하지 않는다.

## 8. 환경 설정

- Zod로 서버 전용 값과 `NEXT_PUBLIC_*` 값을 구분해 빌드·시작 경계에서 검증한다.
- `NEXT_PUBLIC_*`에는 브라우저에 공개돼도 되는 값만 둔다.
- 웹에서 사용하지 않는 API·워커 환경 변수를 공통 스키마에 포함하지 않는다.
