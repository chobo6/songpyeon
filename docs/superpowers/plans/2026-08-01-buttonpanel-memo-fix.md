# ButtonPanel 메모이제이션 누수 수정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `ButtonPanel`이 자신과 무관한 서버 상태 변화(예: 다른 탭의 채팅)에도 불필요하게 리렌더되는 걸 막는다.

**Architecture:** `TeamRosterPanel.tsx`가 이미 쓰고 있는 `memo(Component, customEqualFn)` 패턴을 `ButtonPanel.tsx`에 그대로 적용 — `inventory` 배열을 참조가 아니라 값으로 비교하는 커스텀 비교 함수를 추가한다. `MyTurnScreen.tsx`는 건드리지 않는다.

**Tech Stack:** React 19, TypeScript, Vite

## Global Constraints

- `MyTurnScreen.tsx`의 `Array.from(me.inventory)` 호출과 `inventory` prop의 타입(`ItemId[]`)은 그대로 유지 — 렌더링 정확성을 위해 필요한 코드라 건드리지 않는다.
- 검증용으로 추가하는 렌더 횟수 계측 코드는 확인 후 반드시 제거하고, 커밋에 남기지 않는다.

---

### Task 1: `ButtonPanel`에 커스텀 memo 비교 함수 추가

**Files:**
- Modify: `client/src/components/ButtonPanel.tsx`

**Interfaces:**
- Consumes: 없음(기존 `MyTurnScreen.tsx`/`SoloPlayScreen.tsx`의 호출 방식 그대로).
- Produces: 없음(외부에서 보이는 `ButtonPanel`의 props/동작은 동일 — 언제 리렌더되는지만 바뀜).

- [ ] **Step 1: 수정 전 상태로 재현 — 임시 렌더 카운트 계측 추가**

`client/src/components/ButtonPanel.tsx:22`(`export const ButtonPanel = memo(function ButtonPanel({`)
바로 다음 줄, 함수 본문 맨 위에 임시로 추가:

```ts
  console.log(`[ButtonPanel] render`);
```

- [ ] **Step 2: 클라이언트 빌드 + 서버 동기화**

Run: `npm run sync-public` (루트에서)
Run: `npm run dev:server` (서버가 이미 떠 있다면 재시작)

- [ ] **Step 3: 재현용 계정 3개의 세션 토큰 준비**

`server/` 안에 임시 스크립트를 만든다(이전 세션에서 상점 검증 때 썼던
`make-test-session.ts`와 동일한 패턴):

```ts
// server/make-test-session.ts
import "dotenv/config";
import { getOrCreateUser, setNickname, addGameMoney } from "./src/auth/googleAuth";
import { signSession } from "./src/auth/session";

const sub = process.argv[2];
const nickname = process.argv[3];

const user = getOrCreateUser(sub, {});
setNickname(user.id, nickname);
addGameMoney(user.id, 0);

const token = signSession(user.id);
console.log(JSON.stringify({ userId: user.id, nickname, token }));
```

Run 3번:
```bash
cd server
npx tsx make-test-session.ts memo-fix-pig 돼지역할러
npx tsx make-test-session.ts memo-fix-rabbit 토끼역할러
npx tsx make-test-session.ts memo-fix-spectator 관전러
```

각 출력의 `token` 값을 따로 적어둔다(아래 Playwright 단계에서 씀).

- [ ] **Step 4: Playwright로 방 만들고 매치 시작시키기**

Playwright MCP로 브라우저 페이지 3개를 연다(각각 `page.context().addCookies`로
`session` 쿠키에 위 세 토큰을 각각 심는다 — 이전 세션에서 상점/관리자 검증
때 썼던 방식과 동일).

1. 첫 번째 페이지(돼지역할러)에서 `http://localhost:2567`로 이동, "온라인" →
   "방 만들기"로 `teamCount: 1`인 방을 만든다. 방 코드를 확인한다.
2. 두 번째 페이지(토끼역할러)에서 같은 방 코드로 입장.
3. 두 페이지 모두에서 각자의 역할(돼지/토끼)을 선택 — 로스터가 꽉 차면
   카운트다운이 자동으로 시작되고 매치가 "playing"으로 전환된다.
4. 매치가 시작된 뒤, 세 번째 페이지(관전러)에서 같은 방 코드로 입장 —
   이미 매치가 진행 중이므로 자동으로 관전자로 앉는다.

- [ ] **Step 5: 리렌더 발생 확인 (수정 전)**

돼지역할러 페이지의 브라우저 콘솔 메시지를 확인해서(Playwright의 콘솔 메시지
조회로) `[ButtonPanel] render` 로그가 몇 번 찍혔는지 기록한다.

관전러 페이지에서 채팅창에 아무 메시지나 입력해 전송한다.

돼지역할러 페이지의 콘솔을 다시 확인한다.
Expected: `[ButtonPanel] render` 로그가 **추가로 찍혀 있음** — 채팅과 전혀
무관한 `ButtonPanel`이 리렌더됐다는 뜻으로, 수정 전 버그가 재현된 것.

- [ ] **Step 6: `ButtonPanelProps` 타입 추출 + 커스텀 비교 함수 작성**

`client/src/components/ButtonPanel.tsx:16-36`을 교체:

```ts
interface ButtonPanelProps {
  role: Role;
  disabled: boolean;
  onPress: (color: Color) => void;
  // Optional: online-only, no item system in solo practice mode (see
  // SoloPlayScreen.tsx, which omits both these props entirely).
  inventory?: ItemId[];
  onUseItem?: (itemId: ItemId) => void;
}

// inventory만 값으로 비교하고 나머지는 참조/원시값으로 비교 — role/disabled는
// 원시값, onPress/onUseItem은 호출부(MyTurnScreen.tsx 등)가 이미 useCallback으로
// 안정된 참조를 넘기고 있어 참조 비교로 충분하다. inventory는 매 렌더 새
// 배열이라(MyTurnScreen.tsx의 Array.from(me.inventory) 참고, Colyseus
// ArraySchema가 in-place로 변형되는 걸 우회하기 위한 의도적인 선택) 참조
// 비교로는 항상 "다름"으로 판정되므로, 길이+원소 값으로 직접 비교한다 —
// 인벤토리는 최대 몇 개뿐이라 매번 순회해도 비용이 무시할 만하다.
function buttonPanelPropsEqual(prev: ButtonPanelProps, next: ButtonPanelProps) {
  const prevInventory = prev.inventory ?? [];
  const nextInventory = next.inventory ?? [];
  return (
    prev.role === next.role &&
    prev.disabled === next.disabled &&
    prev.onPress === next.onPress &&
    prev.onUseItem === next.onUseItem &&
    prevInventory.length === nextInventory.length &&
    prevInventory.every((id, i) => id === nextInventory[i])
  );
}

// Memoized so a re-render caused by something else entirely (any colyseus
// patch forces a full-tree re-render — see useMatchRoom.ts) doesn't also
// re-render this and re-touch all 6 button elements' props/styles. Only
// actually helps if `onPress` is a stable reference — callers must
// useCallback it (see MyTurnScreen.tsx, useSoloMatch.ts), otherwise a fresh
// function every render defeats this the same as not memoizing at all.
// `inventory`'s own reference is deliberately NOT part of that guarantee —
// see buttonPanelPropsEqual above.
export const ButtonPanel = memo(function ButtonPanel({
  role,
  disabled,
  onPress,
  inventory = [],
  onUseItem,
}: ButtonPanelProps) {
```

`memo(...)`의 닫는 부분(`client/src/components/ButtonPanel.tsx:203`,
`});`)도 교체해서 비교 함수를 두 번째 인자로 넘긴다:

```ts
}, buttonPanelPropsEqual);
```

- [ ] **Step 7: 타입체크**

Run: `cd client && npx tsc -b`
Expected: 에러 없음.

- [ ] **Step 8: 클라이언트 재빌드 + 서버 동기화**

Run: `npm run sync-public` (루트에서), 이미 떠 있는 서버는 `tsx watch`가
알아서 재시작(정적 파일 변경은 서버 재시작이 원래 필요 없지만, 브라우저
쪽 새로고침은 필요).

- [ ] **Step 9: 리렌더 사라짐 확인 (수정 후)**

Step 4의 세 페이지를 새로고침(재접속)하거나 새로 연결해서 같은 시나리오를
반복한다: 매치를 다시 시작시키고, 관전러가 채팅을 보낸 뒤 돼지역할러 콘솔을
확인한다.
Expected: 관전러의 채팅 전송 이후 `[ButtonPanel] render` 로그가 **더 찍히지
않음**.

- [ ] **Step 10: 임시 계측 코드와 테스트 스크립트 제거**

`client/src/components/ButtonPanel.tsx`에 Step 1에서 추가한
`console.log(\`[ButtonPanel] render\`);` 줄을 삭제한다.

`server/make-test-session.ts`를 삭제한다(Step 3에서 만든 임시 파일).

- [ ] **Step 11: 최종 타입체크 + 빌드**

Run: `cd client && npx tsc -b && npm run build`
Expected: 에러 없음, 빌드 성공.

- [ ] **Step 12: 커밋**

```bash
git add client/src/components/ButtonPanel.tsx
git commit -m "ButtonPanel: inventory 배열 참조 비교 대신 값 비교로 불필요한 리렌더 방지"
```

---

## 최종 확인

```bash
cd client && npx tsc -b && npm run build
```

빌드가 그린이고, `git status`에 임시 스크립트(`server/make-test-session.ts`)나
계측 코드가 남아있지 않은지 확인한다. 배포 여부를 확인한다(이 프로젝트는
브랜치 없이 `main`에 직접 커밋하는 컨벤션이므로 finishing-a-development-branch의
"3옵션" 메뉴는 건너뜀).
