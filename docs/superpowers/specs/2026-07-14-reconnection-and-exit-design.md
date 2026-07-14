# 재접속 정합성 + 뒤로가기 버튼 설계 (2026-07-14)

## 배경

온라인 모드에서 새로고침하면 큐/방 정합성이 깨지는 버그와, 온라인 플로우 도중 모드 선택 화면으로 돌아갈 방법이 없는 문제를 함께 고친다.

### 근본 원인 (systematic-debugging으로 코드 추적해서 확인함)

1. **`client/src/colyseus.ts`가 방/세션 정보를 어디에도 저장하지 않음.** `roomPromise`는 모듈 스코프 JS 변수라 새로고침하면 그냥 사라진다. 새로고침마다 `joinMatch()`는 `client.joinOrCreate("match")`를 **완전히 새로운 연결**로 호출한다.
   - **게임 진행 중(`phase: "playing"`) 새로고침**: `maybeStartGame()`이 이미 `this.lock()`을 건 상태라 `joinOrCreate`가 그 방을 매치메이킹 후보에서 찾지 못한다. 결과적으로 전혀 다른(엉뚱한) 방을 새로 잡거나 만들게 되어, 원래 있던 4인 매치에서 강제로 튕겨나간다.
   - **로비(`phase: "lobby"`) 새로고침**: 옛 연결은 서버가 60초간 재접속 유예(`allowReconnection`, [MatchRoom.ts:58-69](../../../server/src/rooms/MatchRoom.ts#L58-L69))로 살려두는데, 새로 들어온 연결은 이를 모르는 별개 참가자로 취급되어 `onJoin`이 새 `PlayerState`를 만든다. 옛 세션이 이미 차지한 팀의 역할 슬롯은 유령 상태로 남아있어서, 새로고침한 사람은 다른 슬롯/팀으로 밀려나거나(둘 다 차 있으면) `chooseRole`이 조용히 실패한다. "이미 만들어진 큐가 있는데도 다른 큐로 들어가는" 증상의 원인.

2. **`onLeave()`가 게임 단계와 무관하게 항상 60초 재접속 유예를 검.** 실제 대결 중이면 네트워크 순간 끊김을 보호하기 위해 합리적이지만, 아직 로비에서 팀도 안 맞춰진 상태에서 창을 닫아도 60초 동안 자리를 붙잡고 있어 "큐를 잡고 창을 꺼버려도 큐에 남아있는" 증상이 발생한다.

3. **`App.tsx`의 `OnlineFlow`에 `onExit`이 연결되어 있지 않음.** "연결 중" 화면과 로비(`RoleSelect`)에는 뒤로가기/나가기 버튼이 전혀 없다. 탈락 후 관전 화면(`SpectatorScreen`)에만 "나가기"(재입장) 버튼이 있다 — 이건 별개 기능으로 그대로 둔다.

## 수정 방향

### A. 클라이언트 재접속 토큰 저장 (`client/src/colyseus.ts`)

Colyseus는 `room.reconnectionToken`을 접속 직후부터 제공하고, `client.reconnect(token)`으로 **같은 세션을 복구**할 수 있다 (colyseus.js 0.16, `lib/Client.d.ts`/`lib/Room.d.ts` 확인함).

- 접속(신규 join 또는 reconnect) 성공 시 `room.reconnectionToken`을 `sessionStorage`에 저장.
- `joinMatch()`는 저장된 토큰이 있으면 `client.reconnect(token)`을 먼저 시도. 실패하면(만료/무효/서버가 거부) 저장된 토큰을 지우고 기존처럼 `client.joinOrCreate("match")`로 폴백.
- `leaveMatch()`(의도적으로 나가는 경우 — 뒤로가기 버튼, 탈락 후 재입장 등) 호출 시 저장된 토큰도 함께 삭제해서, 다음 `joinMatch()`가 방금 나간 세션으로 재접속을 시도하지 않게 한다.
- `roomPromise` 모듈 스코프 캐싱(StrictMode 이중 호출 방지, 기존 주석 참고)은 그대로 유지 — reconnect 시도 로직은 이 캐시된 프로미스 안에서 일어나게 짠다.

이 변경만으로 **게임 진행 중 새로고침**은 완전히 해결된다: 같은 세션으로 복구되므로 다른 방으로 튕기는 일이 없다.

**로비 새로고침은 이 토큰만으로는 해결되지 않는다** — 아래 B에서 로비는 유예 없이 즉시 삭제하기로 했기 때문에, 로비 중 새로고침은 재접속에 실패하고 일반 매치메이킹으로 폴백된다(사용자 확인 사항, 아래 참고).

### B. 로비에서는 재접속 유예 없이 즉시 정리 (`server/src/rooms/MatchRoom.ts`)

`onLeave`를 게임 단계에 따라 분기한다:

- `state.phase === "playing"`: 기존 그대로 60초 `allowReconnection` 유지 (A의 재접속 토큰이 실제로 쓰이는 경우).
- 그 외(`lobby`): 유예 없이 즉시 플레이어 삭제 + 그 플레이어가 차지하고 있던 팀의 역할 슬롯(`pigSessionId`/`rabbitSessionId`)도 함께 비운다.

**트레이드오프(사용자 확인 완료)**: 로비 중 새로고침은 재접속되지 않고 새 매치메이킹으로 처리된다 — 정확히 같은 방으로 돌아간다는 보장은 없지만, 유령 슬롯이 없어져서 "옛 자리가 남아 새 슬롯으로 밀려나는" 문제 자체가 사라진다. 반대로 즉시 삭제 없이 짧은 유예(예: 10초)를 주는 대안도 검토했으나, 로비 이탈은 흔하고 빠른 순환이 더 중요하다고 판단해 기각.

### C. 뒤로가기 버튼

- **"연결 중" 화면**(`OnlineFlow`, `status !== "connected"`)과 **로비**(`RoleSelect`, `phase === "lobby"`)에 "나가기" 버튼을 추가한다. 누르면 정상적으로(consented) 방을 나가고(`leaveMatch()` 재사용 → 서버 `onLeave(client, consented=true)`가 즉시 삭제) `App`의 모드를 `"select"`로 되돌린다.
- **실제 플레이 중(내 턴이든 팀원 턴이든, 내 팀이 살아있는 동안)에는 버튼을 노출하지 않는다** (사용자 확인 — 팀원에게 피해를 주지 않기 위해). 즉 `MyTurnScreen`과 `SpectatorScreen`의 `eliminated === false` 분기에는 손대지 않는다.
- 탈락 후 관전 화면(`SpectatorScreen`, `eliminated === true`)의 기존 "나가기"(→ `leaveAndRejoin`, 나간 뒤 즉시 새 매치메이킹) 버튼은 **변경하지 않는다** — 이번 작업에서 추가하는 "나가기"(→ 모드 선택 화면)와는 별개 동작이다.

## 코드 흐름 변경 요약

```
client/src/colyseus.ts
 ├─ joinMatch(): sessionStorage에 토큰 있으면 client.reconnect() 우선 시도 → 실패시 joinOrCreate() 폴백
 └─ leaveMatch(): room.leave() + sessionStorage 토큰 삭제 (기존 로직 + 토큰 삭제만 추가)

client/src/game/useMatchRoom.ts
 └─ cancelAndExit(): leaveMatch()만 호출 (재입장 없음) — 새 함수, leaveAndRejoin과 별개

client/src/App.tsx
 └─ OnlineFlow({ onExit }) — onExit을 App이 setMode("select")로 넘겨줌

client/src/components/Game.tsx
 └─ phase === "lobby"일 때만 RoleSelect에 onExit 전달 (MyTurnScreen/SpectatorScreen엔 안 건드림)

client/src/components/RoleSelect.tsx
 └─ onExit prop 받아서 "나가기" 버튼 렌더링

server/src/rooms/MatchRoom.ts
 └─ onLeave(): phase === "playing" ? 기존 60초 유예 : 즉시 삭제 + 팀 슬롯 비우기
```

## 새로 만들 파일

없음 — 전부 기존 파일 수정.

## 명시적 범위 제외

- 탈락 후 관전 화면의 기존 "나가기"(재입장) 로직 변경 없음.
- 실제 플레이 중(내 팀 생존 중)에는 나가기 버튼 없음.
- 로비 새로고침 시 "정확히 같은 방으로 복귀"는 보장하지 않음 (사용자 확인하에 기각한 대안).
- 접속 끊김 관련 UI(재접속 유예 중인 팀원 표시)는 `docs/todo.md`에 이미 있는 별개 항목 — 이번 작업 범위 아님.

## 테스트 계획

- **서버**: `server/src/rooms/MatchRoom.test.ts`에 로비 단계 드롭 테스트 추가 — 팀이 다 안 찼을 때 클라이언트가 비정상 종료하면 `state.players`에서 즉시 삭제되고 해당 팀의 역할 슬롯도 바로 비는지 확인. 기존 "재접속" 테스트(`fillRolesAndStart()`로 `playing` 단계에서 검증)는 변경 없이 통과해야 함.
- **클라이언트**: 자동화 테스트 없음(기존 관례) — `tsc`/`lint` + Playwright 수동 확인. 확인할 시나리오: (1) 플레이 중 새로고침 시 같은 방/역할로 복구, (2) 로비에서 뒤로가기 버튼으로 모드 선택 화면 복귀, (3) "연결 중" 화면에서 뒤로가기, (4) 플레이 중에는 나가기 버튼이 안 보임, (5) 탈락 후 관전 화면의 기존 나가기(재입장) 버튼은 그대로 동작.
