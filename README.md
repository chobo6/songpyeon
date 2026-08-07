# 송편 만들기 웹 게임

"마피아42"의 이벤트 미니게임 **"송편만들기대작전"**을 [Colyseus](https://colyseus.io/) 기반 실시간 멀티플레이어 웹 게임으로 이식한 프로젝트입니다.

## 게임 소개

- 팀전(팀당 2명: 돼지 1 + 토끼 1, 방 생성 시 1~4팀 선택 가능)으로 진행되는 실시간 협동 리듬 게임입니다.
- 팀의 턴이 되면 4초 안에, 화면에 뜨는 버튼 시퀀스를 정해진 절대 순서대로 두 팀원이 번갈아 눌러야 합니다.
- 절구(팀 공유 생명력)를 모두 잃으면 해당 팀은 탈락하지만, 매치 자체는 끝나지 않고 생존 팀이 계속 라운드를 이어갑니다("승리" 개념이 없는 무한 라운드 구조).
- 정확한 규칙은 [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) 참고.

### 그 밖의 기능

- 구글 로그인 기반 계정, 친구 추가/초대/1:1 채팅, 방 안 대기실/관전, 진행 중인 매치 관전 입장
- 판수·최고 라운드 등 개인 기록, 라운드 랭킹(TOP 10), 게임머니 적립(턴 성공 시 지급) 및 상점 소비
- 팀 콤보·개인 평균 속도 HUD 표시
- 아이템전(방 생성 시 선택): 시퀀스에 등장하는 보너스 토큰을 먹으면 개인 인벤토리에 아이템 획득 — 시간추가/시간감소/반죽공격/슈퍼절구/절구회복 5종
- 닉네임 색상 및 레인보우/샤인/홀로그램/Pulse/네온사인/크롬 효과, 파티클(반짝임/상승/궤도/눈) 효과, 닉네임변경권·확성기 등을 게임머니로 구매하는 상점
- 로비 내 관리자 문의하기 기능
- 관리자 페이지(`/admin`): 실시간 접속 현황, 입장/퇴장 로그, 일일 방문자수, 공지 배너/확성기, 유저 밴, 계정별 IP 이력, 게임머니 수동 조정, 부정 입력 모니터링

## 기술 스택

| 영역 | 스택 |
|---|---|
| 프론트엔드 | React 19 + TypeScript + Vite |
| 실시간 서버 | Node.js + TypeScript + Colyseus (서버 권위형 상태 동기화) |
| 데이터베이스 | SQLite (better-sqlite3) |
| 인증 | Google OAuth (ID 토큰 검증), JWT 세션 쿠키 |
| 배포 | AWS EC2 + Docker + Caddy(자동 HTTPS 리버스 프록시) |

기술 선택 이유는 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 참고.

## 프로젝트 구조

npm workspaces 모노레포입니다.

```
songpyeon/
├── client/                 # React + Vite 프론트엔드
│   └── src/
│       ├── components/     # 화면/모달 단위 컴포넌트
│       ├── game/           # 클라이언트 게임 로직, API 호출 헬퍼
│       └── assets/
├── server/                 # Node + Colyseus 백엔드
│   └── src/
│       ├── game/           # 순수 함수로 분리된 핵심 게임 규칙 (각각 테스트 동반)
│       ├── rooms/          # Colyseus Room (MatchRoom) / State (MatchState)
│       ├── auth/           # 구글 로그인, 세션, 유저 프로필/상점
│       ├── friends/        # 친구 요청/초대
│       ├── chat/           # 인게임 채팅, 1:1 다이렉트 메시지
│       ├── admin/          # 관리자 페이지 API (모니터링, 밴, 공지)
│       └── db/             # SQLite 연결 및 스키마 마이그레이션
├── docs/                   # 요구사항 명세, 아키텍처, 트러블슈팅, 설계 문서
└── package.json            # workspaces root
```

## 로컬 실행

루트 디렉토리에서:

```bash
npm install
npm run dev          # server(2567)+client(5173) 동시 실행
```

| 명령어 | 설명 |
|---|---|
| `npm run dev` | server + client 동시 실행 |
| `npm run dev:server` | server만 실행 |
| `npm run dev:client` | client만 실행 |
| `npm run sync-public` | client 빌드 후 server/public에 복사 — 관리자 페이지/구글 로그인처럼 same-origin이 필요한 기능을 로컬 2567 포트에서 확인할 때 사용 |

서버 환경변수(`GOOGLE_CLIENT_ID`, `SESSION_JWT_SECRET`, `ADMIN_PASSWORD`)는 `server/.env`에서 읽습니다(git 미포함, 직접 생성 필요). 클라이언트 쪽 `VITE_GOOGLE_CLIENT_ID`는 `client/.env.local`에서 읽습니다.

### 개별 워크스페이스 명령어

**server/**
```bash
npm run dev    # tsx watch src/index.ts
npm test       # vitest run
npm run build  # tsc --noEmit (타입체크만)
```

**client/**
```bash
npm run dev    # vite
npm run build  # tsc -b && vite build
npm run lint   # oxlint
```

## 배포

AWS EC2 단일 인스턴스에 Docker 컨테이너로 배포합니다(CI/CD 없이 수동: `docker build` → `docker save` → `scp` → EC2에서 `docker load` 후 컨테이너 교체). 앞단에 Caddy가 자동 HTTPS 리버스 프록시로 붙어 있습니다. 자세한 절차와 유의사항은 [docs/superpowers/specs/2026-07-15-aws-light-deploy-test-design.md](docs/superpowers/specs/2026-07-15-aws-light-deploy-test-design.md)와 [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) 참고.

## 문서

- [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) — 게임 규칙 명세
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — 기술 스택 선택 이유
- [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) — 실제 발생한 버그와 근본 원인 기록
- [docs/todo.md](docs/todo.md) — 다음 할 일
- [CLAUDE.md](CLAUDE.md) — 아키텍처/기능별 상세 노트, 개발 시 유의사항(Gotchas)
