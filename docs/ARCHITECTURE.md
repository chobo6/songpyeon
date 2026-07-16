# 송편 만들기 웹 게임 — 기술 스택 / 아키텍처 (v0.1)

## 1. 결정 사항

| 영역 | 선택 | 이유 |
|---|---|---|
| 프론트엔드 | React + TypeScript + Vite | 정보/생태계가 가장 풍부, 빠른 개발 서버 |
| 실시간 서버 | Node.js + TypeScript + **Colyseus** | 방(room) 단위 서버 권위형 상태 동기화가 이 게임(팀 4명, 공유 시퀀스, 절구, 4초 타이머)의 요구사항과 정확히 일치. 상태 diff 브로드캐스트·재연결·룸 생명주기를 프레임워크가 처리 |
| 배포 | AWS EC2 단일 인스턴스 + Docker 컨테이너 하나 + Caddy(자동 HTTPS) | omok의 kind→EKS 학습 경로와 별개로, 이 프로젝트는 친구들과의 캐주얼 테스트가 목적이라 k8s는 오버킬 — 자세한 내용은 `docs/superpowers/specs/2026-07-15-aws-light-deploy-test-design.md` 참고 |

## 2. 왜 서버 권위형(authoritative)인가

- 게임의 핵심 규칙(§REQUIREMENTS.md §3~§5)은 "정확한 순서 판정"과 "팀 공유 자원(절구)"에 의존한다.
- 클라이언트가 각자 판정하면 두 팀원의 화면이 미묘하게 어긋나는 동기화 버그가 발생하기 쉽다.
- 따라서 서버가 다음을 전부 소유한다: 시퀀스 생성(§4), 현재 처리 위치(커서), 4초 타이머, 절구 개수, 라운드/팀 진행 상태, 승리/탈락 판정.
- 클라이언트는 입력(버튼 클릭)을 서버로 보내고, 서버가 검증한 결과(상태 diff)만 받아 그린다 — "그리기 전용" 클라이언트.

## 3. Colyseus 개념 매핑

| Colyseus 개념 | 이 게임에서의 의미 |
|---|---|
| Room | 한 경기의 세션. 팀 개수는 방 생성 시 1~3팀 중 선택(팀당 2명 고정, 총 2~6명) |
| State (Schema) | 팀별 절구 수, 현재 라운드, 현재 턴 팀, 시퀀스 배열, 커서 위치, 각 플레이어의 역할 |
| Message (client→server) | 버튼 입력 (`pressButton: { color }`) |
| Message (server→client, 자동) | State 변경분 자동 브로드캐스트 (커서 이동, 절구 감소, 라운드 증가 등) |
| onJoin / onLeave | 참가자 입장/퇴장 처리, 탈락 후 관전 모드 전환 |

## 4. 저장소 구조 (모노레포)

```
songpyeon/
  docs/
    REQUIREMENTS.md
    ARCHITECTURE.md
  package.json          # workspaces root, concurrently로 dev 동시 실행
  kill-ports.js          # dev 실행 전 5173/2567 점유 프로세스 정리 (omok와 동일 패턴)
  client/                # React + TS + Vite
  server/                # Node + TS + Colyseus
```

- 프론트/백엔드를 하나의 저장소에서 npm workspaces로 관리 (별도 배포 아티팩트는 추후 분리 가능).
- 문서는 `docs/`에 모아 omok 프로젝트와 동일한 관례를 따름.
- 루트에서 `npm run dev` 한 번으로 server(2567)+client(5173)가 동시에 뜬다 (omok와 동일하게 `concurrently` 사용).

## 5. 다음 단계

완료: 모노레포 스캐폴딩, 로컬 dev 연결, 코어 게임 로직, 클라이언트 화면, 배포(AWS EC2+Docker+Caddy).
앞으로 할 일은 `docs/todo.md` 참고.
