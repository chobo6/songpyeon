# 한 계정 동시 다중 참가 방지 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 같은 계정이 같은 매치룸에 동시에 두 번째 플레이어 자리로 들어오는 것을 막아, 턴 성공 보상을 두 배로 받는 악용을 차단한다.

**Architecture:** `MatchRoom.ts`의 `onJoin`이 이미 세션ID→유저ID를 추적하는 `playerUserIds` 맵을 갖고 있으므로, 플레이어를 새로 앉히기 직전에 그 유저ID가 이미 이 맵의 값에 있는지 한 번만 확인하면 된다. 관전자 분기는 건드리지 않고, 정상적인 재접속(`allowReconnection`)은 이 코드 경로 자체를 타지 않으므로 영향이 없다.

**Tech Stack:** Node.js/TypeScript/Colyseus/Vitest

## Global Constraints

- 이미 플레이어로 들어간 계정의 다른 탭이 같은 방을 **관전**하는 것은 막지 않는다 — 관전은 보상이 없어 악용이 아니다.
- 서로 다른 방에 동시 참가하는 것은 이번 스코프 밖 — 매치가 독립적이라 다중 참가 자체가 이득이 되지 않는다.
- 정상 재접속(새로고침, 네트워크 끊김 후 재접속)은 영향받지 않아야 한다.

---

### Task 1: `onJoin`에 같은 계정 중복 플레이어 참가 가드 추가

**Files:**
- Modify: `server/src/rooms/MatchRoom.ts:265-268`
- Modify: `server/src/rooms/MatchRoom.test.ts` (새 테스트 추가 + 기존 테스트 1개 수정)

**Interfaces:**
- Consumes: 기존 `this.playerUserIds: Map<string, number>`(세션ID→유저ID), `client.auth.userId`(이미 `onAuth`가 채워줌).
- Produces: 없음(내부 동작 변경, 새 타입/함수 없음).

- [ ] **Step 1: 실패하는 테스트부터 작성**

`server/src/rooms/MatchRoom.test.ts`의 `describe("user ban", ...)` 블록(약 1558번 줄)
바로 앞에 새 `describe` 블록을 추가한다. 기존 파일 하단의 "user ban" 블록이 쓰는
수동 연결 패턴(같은 `signSession(user.id)` 토큰으로 `ColyseusJsClient`를 두 번
만드는 방식)을 그대로 따른다:

```ts
describe("duplicate account join guard", () => {
  test("a second connection from the same account is rejected while it would otherwise become a second player", async () => {
    const room = await colyseus.createRoom<MatchState>("match", { teamCount: 1 });
    testUserCounter += 1;
    const user = getOrCreateUser(`test-google-sub-${testUserCounter}`, {});
    setNickname(user.id, "다중접속시도");
    const token = signSession(user.id);
    const port = (colyseus.server as unknown as { port: number }).port;

    const firstClient = new ColyseusJsClient(`ws://127.0.0.1:${port}`, {
      headers: { Cookie: `session=${token}` },
    });
    await firstClient.joinById<MatchState>(room.roomId);

    const secondClient = new ColyseusJsClient(`ws://127.0.0.1:${port}`, {
      headers: { Cookie: `session=${token}` },
    });
    await expect(secondClient.joinById<MatchState>(room.roomId)).rejects.toThrow(
      "이미 이 방에 참가 중인 계정입니다",
    );
  });

  test("two different accounts can both join as players normally", async () => {
    const room = await colyseus.createRoom<MatchState>("match", { teamCount: 1 });
    const firstClient = await connectAsUser(colyseus, room, "정상유저1");
    const secondClient = await connectAsUser(colyseus, room, "정상유저2");
    await flush();

    expect(room.state.players.has(firstClient.sessionId)).toBe(true);
    expect(room.state.players.has(secondClient.sessionId)).toBe(true);
  });
});
```

- [ ] **Step 2: 테스트 실행해서 첫 번째 테스트가 실패하는지 확인**

Run: `cd server && npx vitest run MatchRoom -t "a second connection from the same account"`
Expected: FAIL — `secondClient.joinById(...)`가 거부되지 않고 그대로 성공해서
`rejects.toThrow(...)` 단언이 실패함 (현재 코드는 같은 계정의 두 번째 플레이어
참가를 막지 않으므로).

- [ ] **Step 3: `onJoin`에 가드 추가**

`server/src/rooms/MatchRoom.ts:265-268`을 교체:

```ts
    if (this.state.players.size >= this.playerCapacity) {
      throw new Error("방이 가득 찼습니다.");
    }

    // 같은 계정이 탭 두 개(또는 기기 두 개)로 같은 방에 동시에 플레이어로 들어와
    // creditTurnSuccess의 턴 성공 보상을 두 배로 받는 걸 막는다. 관전은 이 체크와
    // 무관(관전자는 playerUserIds에 안 들어감)하고, 정상 재접속(allowReconnection)은
    // onAuth/onJoin을 다시 안 거치는 별개 경로라 여기 걸리지 않는다.
    const joiningUserId = client.auth?.userId;
    if (joiningUserId !== undefined && [...this.playerUserIds.values()].includes(joiningUserId)) {
      throw new Error("이미 이 방에 참가 중인 계정입니다.");
    }
```

- [ ] **Step 4: 새 테스트 2개 재실행해서 통과 확인**

Run: `cd server && npx vitest run MatchRoom -t "duplicate account join guard"`
Expected: PASS (2개 전부 — 중복 참가 거부 테스트, 서로 다른 계정 정상 참가 테스트)

- [ ] **Step 5: 파일 전체 테스트 실행해서 기존 테스트 중 무엇이 깨지는지 확인**

Run: `cd server && npx vitest run MatchRoom -t "kickUserId disconnects every connection"`
Expected: FAIL — `server/src/rooms/MatchRoom.test.ts:1600-1631`의 기존 테스트는
**의도적으로** 같은 계정으로 같은 방에 두 번 플레이어로 들어가는 상황을
만들어서 `kickUserId`가 "먼저 찾은 것뿐 아니라 그 계정의 모든 연결"을 끊는지
검증했다 — 이제 그 전제(같은 계정 두 번째 플레이어 참가)가 막혔으니 이 테스트를
고쳐야 한다.

- [ ] **Step 6: 그 테스트를 "플레이어 연결 + 관전자 연결" 조합으로 다시 쓴다**

`server/src/rooms/MatchRoom.test.ts:1600-1631`(`test("kickUserId disconnects
every connection the user holds in this room, not just the first found", ...)`
전체)을 교체 — 매치를 실제로 시작시킨 뒤(phase: "playing") 같은 계정의 두 번째
연결을 시도하면 관전자로 자연스럽게 앉는다(방금 추가한 가드는 관전자 분기와
무관하므로 안 걸림). 이렇게 만든 "플레이어 연결 + 관전자 연결" 조합으로,
`kickUserId`가 역할과 무관하게 그 계정의 모든 연결을 찾아 끊는지 그대로
검증한다. 플레이어 쪽은 매치 진행 중 강제 종료라 다른 비정상 접속 끊김과
동일하게 재접속 유예 경로를 타므로(`kickUserId during an active match...`
테스트, 약 1633번 줄, 와 동일한 이유), `reconnectGraceSeconds`를 짧게 주고
`waitUntil`로 유예시간이 끝나길 기다린다:

```ts
    test("kickUserId disconnects every connection the user holds in this room, not just the first found", async () => {
      const room = await colyseus.createRoom<MatchState>("match", {
        teamCount: 1,
        countdownTickMs: COUNTDOWN_TICK_MS,
        bonusItemRng: NEVER_BONUS_RNG,
        reconnectGraceSeconds: 0.05,
      });
      const port = (colyseus.server as unknown as { port: number }).port;

      testUserCounter += 1;
      const targetUser = getOrCreateUser(`test-google-sub-${testUserCounter}`, {});
      setNickname(targetUser.id, "이중접속유저");
      const targetToken = signSession(targetUser.id);

      testUserCounter += 1;
      const otherUser = getOrCreateUser(`test-google-sub-${testUserCounter}`, {});
      setNickname(otherUser.id, "상대유저");
      const otherToken = signSession(otherUser.id);

      // 첫 연결(플레이어)이 pig 역할을 맡고, 다른 계정이 rabbit을 맡아 매치를
      // 시작시킨다 — 매치가 시작된 뒤(phase: "playing")라야 같은 계정의 두 번째
      // 연결이 (플레이어 중복 참가 가드에 걸리지 않고) 관전자로 자연스럽게 앉는다.
      const targetPlayerClient = new ColyseusJsClient(`ws://127.0.0.1:${port}`, {
        headers: { Cookie: `session=${targetToken}` },
      });
      const targetPlayerJoined = await targetPlayerClient.joinById<MatchState>(room.roomId);
      targetPlayerJoined.send("chooseRole", { role: "pig" });

      const otherClient = new ColyseusJsClient(`ws://127.0.0.1:${port}`, {
        headers: { Cookie: `session=${otherToken}` },
      });
      const otherJoined = await otherClient.joinById<MatchState>(room.roomId);
      otherJoined.send("chooseRole", { role: "rabbit" });

      await flush();
      await waitForCountdown();

      // 같은 계정(같은 세션 토큰)으로 세 번째 연결 — 매치가 이미 시작된 뒤라
      // 관전자로 앉는다(플레이어 중복 참가 가드는 관전자 분기와 무관).
      const targetSpectatorClient = new ColyseusJsClient(`ws://127.0.0.1:${port}`, {
        headers: { Cookie: `session=${targetToken}` },
      });
      const targetSpectatorJoined = await targetSpectatorClient.joinById<MatchState>(room.roomId);
      await flush();

      expect(room.state.players.has(targetPlayerJoined.sessionId)).toBe(true);
      expect(room.state.spectators.has(targetSpectatorJoined.sessionId)).toBe(true);

      const kicked = (room as unknown as MatchRoom).kickUserId(targetUser.id);
      await flush();

      expect(kicked).toBe(true);
      // 관전자는 즉시 제거되지만, 플레이어는 매치 진행 중 강제 종료라 다른 비정상
      // 접속 끊김과 동일하게 재접속 유예 경로를 탄다 — 유예시간이 끝나길 기다려야 한다.
      expect(room.state.spectators.has(targetSpectatorJoined.sessionId)).toBe(false);
      await waitUntil(() => !room.state.players.has(targetPlayerJoined.sessionId));
    });
```

- [ ] **Step 7: 수정한 테스트 재실행해서 통과 확인**

Run: `cd server && npx vitest run MatchRoom -t "kickUserId disconnects every connection"`
Expected: PASS

- [ ] **Step 8: `MatchRoom.test.ts` 파일 전체 + 서버 전체 테스트 실행해서 다른 회귀 없는지 확인**

Run: `cd server && npx vitest run`
Expected: 이 태스크에서 손댄 3개 테스트(신규 2개 + 수정 1개) 외엔 결과 변화 없음.

- [ ] **Step 9: 타입체크**

Run: `cd server && npm run build`
Expected: 에러 없음.

- [ ] **Step 10: 커밋**

```bash
git add server/src/rooms/MatchRoom.ts server/src/rooms/MatchRoom.test.ts
git commit -m "매치룸: 같은 계정 동시 다중 참가 방지 (턴 보상 이중 지급 악용 차단)"
```

---

## 최종 확인

```bash
cd server && npx vitest run && npm run build
```

전부 그린이면(팀 탈락 관련 기존 무관 실패가 있다면 이 플랜과 무관하니 무시) 배포
여부를 확인한다(이 프로젝트는 브랜치 없이 `main`에 직접 커밋하는 컨벤션이므로
finishing-a-development-branch의 "3옵션" 메뉴는 건너뜀).
