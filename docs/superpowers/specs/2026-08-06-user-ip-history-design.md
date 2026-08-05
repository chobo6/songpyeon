# 계정별 IP 이력 수집 설계 문서

## 배경

계정의 과거 IP를 조사하려면 지금까지는 `events` 테이블(매치룸에 실제로
입장/퇴장한 경우만 기록, 90일 후 삭제)에 의존해야 했다. 로그인만 하고
방에 한 번도 안 들어간 계정은 IP를 알아낼 방법이 아예 없었다(직접 겪은
사례: "앙기모띠" 계정 — 가입/로그인 기록은 있지만 매치룸에 안 들어가서
IP 조회 불가). 온라인 모드에 진입할 때마다(로그인 여부와 무관한 "일일
방문자" 집계와 달리, 이건 로그인된 계정에 한정) 그 계정이 쓴 IP를
누적 수집해서 이 문제를 해결한다.

## 데이터 모델

```sql
CREATE TABLE IF NOT EXISTS user_ips (
  user_id INTEGER NOT NULL,
  ip TEXT NOT NULL,
  first_seen TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  last_seen TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  PRIMARY KEY (user_id, ip)
)
```

`PRIMARY KEY (user_id, ip)`이므로 같은 계정이 같은 IP로 다시 들어오면
`last_seen`만 갱신되고(중복 행 없음), 이전에 없던 새 IP면 새 행이
추가된다 — "이전 IP와 같으면 냅두고 다르면 추가로 수집"이 SQL 제약조건
하나로 자연스럽게 구현된다. 별도의 "이전 IP와 비교" 로직을 애플리케이션
코드에서 따로 짤 필요가 없다.

**보관 기간: 무기한.** `events`(90일)나 `daily_visit_log`(로그인 유저는
IP 자체를 안 담음)와 달리, 이 테이블의 존재 이유 자체가 "몇 달 뒤에도 이
계정이 과거에 어떤 IP를 썼는지" 조사하기 위함이라 보관 기간을 두면 목적과
어긋난다. 계정이 삭제되면(현재 계정 삭제 기능은 없지만) 같이 정리하는 게
맞겠으나, 이번 스코프에서는 계정 삭제 기능 자체가 없으므로 다루지 않는다.

## 서버

**`server/src/admin/userIps.ts`** (신규):
- `recordUserIp(userId: number, ip: string): void` — `ip`가 `"unknown"`이면
  기록하지 않는다(의미 없는 값). 그 외엔 `INSERT ... ON CONFLICT(user_id, ip)
  DO UPDATE SET last_seen = datetime('now', '+9 hours')`.
- `getIpsForUser(userId: number): { ip: string; firstSeen: string; lastSeen: string }[]`
  — 해당 계정의 IP 이력을 `last_seen` 내림차순(최근 접속 순)으로 반환.

**`GET /api/auth/me`** (`createServer.ts`) — 기존에 `touchLastLogin(userId)`를
호출하는 자리 바로 옆에 `recordUserIp(userId, req.ip ?? "unknown")`을 추가한다.
이 라우트는 이미 온라인 모드 진입 시(`App.tsx`의 `OnlineFlow` 마운트) 한 번
호출되고 있으므로 클라이언트 변경이 전혀 없다.

**`GET /api/admin/users/:id/ips`** (신규, `requireAdmin`) — `getIpsForUser`의
결과를 그대로 JSON 배열로 반환.

## 클라이언트

**`AdminEditUserModal.tsx`** — 기존 4개 섹션(닉네임/색상/효과/게임머니) 뒤에
읽기 전용 "IP 이력" 섹션을 추가한다. 모달이 열릴 때(`user` prop 확정 시) 한
번 `GET /api/admin/users/:id/ips`를 불러와서 IP·처음 본 날짜·마지막 본
날짜를 목록으로 보여준다. 다른 섹션과 달리 수정 기능은 없다(그냥 조회).

## 테스트

- 서버: `userIps.test.ts` 신규 —
  - 같은 유저가 같은 IP로 여러 번 기록해도 행이 하나만 남고 `last_seen`만
    갱신되는지.
  - 같은 유저가 다른 IP로 기록하면 별도 행이 추가되는지(기존 IP 행은
    그대로 유지).
  - 서로 다른 유저는 같은 IP를 써도 각자 독립적으로 기록되는지.
  - `ip === "unknown"`이면 기록되지 않는지.
  - `getIpsForUser`가 `last_seen` 내림차순으로 반환하는지.
- 클라이언트: 기존 컨벤션대로 타입체크 + 수동/Playwright 확인 — 관리자
  페이지에서 유저 수정 모달을 열어 IP 이력이 실제로 뜨는지 확인한다.

## 범위 제외

- 계정 삭제 시 `user_ips` 정리 — 계정 삭제 기능 자체가 없으므로 해당 없음.
- IP 이력을 이용한 자동 알림/경고(예: 밴 계정과 같은 IP 감지 시 알림) —
  지금까지처럼 관리자가 직접 조회해서 판단하는 방식 그대로 유지, 자동화는
  별도 스펙.
