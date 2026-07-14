# AWS 라이트 배포 테스트 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **예외 주의**: Task 2와 Task 3은 AWS 콘솔 GUI 조작 및 실제 과금되는 EC2 인스턴스에 대한 SSH/배포
> 작업을 포함한다. Subagent는 브라우저로 AWS 콘솔을 조작할 수 없고, 살아있는 외부 인프라에 대한
> 작업은 사용자 확인 없이 진행해서는 안 되므로, **Task 2/3은 subagent에 위임하지 말고 컨트롤러가
> 사용자와 대화하며 단계별로 직접 진행**한다. Task 1만 정상적인 subagent-driven-development 대상이다.

**Goal:** songpyeon을 EC2 인스턴스 하나 + Docker 컨테이너 하나로 온라인에 1회성으로 띄워서, 실제
인터넷 환경(서로 다른 네트워크의 친구들)에서 지연/타이밍이 게임플레이에 영향을 주는지 테스트한다.

**Architecture:** server(Express+Colyseus)가 client의 프로덕션 빌드 결과물까지 같이 서빙하는 단일
컨테이너. 도메인/TLS 없이 `http://<EC2 퍼블릭 IP>`로 직접 접속. 저작권이 있는 게임 에셋
(`client/public/game-assets/`, git에도 비공개)이 이미지에 포함되므로 Docker Hub 등 레지스트리를
거치지 않고 `docker save`+`scp`로 EC2에 직접 전송한다.

**Tech Stack:** Docker (multi-stage build), Express `express.static`, AWS EC2 (Amazon Linux 2023,
t3.micro), 보안그룹, SSH/SCP.

## Global Constraints

- 이 레포는 npm workspaces이며 `package-lock.json`이 레포 **루트에만** 존재한다 — `server/`나
  `client/` 디렉터리 안에서 단독으로 `npm ci`를 실행하면 lockfile을 못 찾아 실패한다. 모든 Docker
  스테이지는 루트에서 `npm ci`를 실행해야 한다.
- `server/package.json`의 `build` 스크립트는 `tsc --noEmit`(타입체크 전용, 컴파일 산출물 없음)이다.
  프로덕션 실행도 `npm start`(`tsx src/index.ts`)로 TS를 직접 실행하는 기존 방식을 그대로 쓴다 —
  별도 컴파일 스테이지를 추가하지 않는다. 따라서 Docker 이미지에 `tsx`/`typescript` 같은
  devDependencies까지 반드시 설치되어야 한다 (`npm ci`에 `--omit=dev`를 쓰지 않는다).
- 로컬 개발 흐름(`npm run dev`, client의 `vite` dev 서버가 5173, server가 2567에서 각각 실행)은
  이번 작업으로 절대 건드리지 않는다. 프로덕션 전용 코드 경로는 `import.meta.env.PROD` 분기로
  격리한다.
- `client/public/game-assets/`는 git에 커밋되지 않는 저작권 리소스다 (`client/.gitignore`).
  로컬 파일시스템에는 존재하므로 `docker build`는 정상 동작하지만, 빌드된 이미지를 Docker Hub 등
  제3자 레지스트리에 절대 push하지 않는다 — `docker save`로 tar 파일을 만들어 `scp`로 EC2에 직접
  전송하는 경로만 사용한다.
- 이 프로젝트는 서버 권위형 구조로 방(room) 상태를 메모리에 들고 있다 (`MatchRoom`) — 컨테이너/EC2
  인스턴스는 반드시 1개만 띄운다. 여러 개로 늘리는 건 이번 계획의 범위 밖이다.

---

### Task 1: 프로덕션 빌드 지원 코드 변경 + Dockerfile + 로컬 통합 검증

**Files:**
- Modify: `client/src/colyseus.ts`
- Modify: `server/src/createServer.ts`
- Create: `Dockerfile` (레포 루트)
- Create: `.dockerignore` (레포 루트)

**Interfaces:**
- Consumes: 기존 `client/src/colyseus.ts`의 `const endpoint = import.meta.env.VITE_SERVER_URL ?? "ws://localhost:2567";` (1줄), 기존 `server/src/createServer.ts`의 `createGameServer(): Server` 함수 전체 (아래 "현재" 코드가 정확한 현재 상태).
- Produces: 이후 Task(AWS 배포)가 사용할 `docker build -t songpyeon:test .` 명령과, 컨테이너가 내부적으로 듣는 포트 `2567`(환경변수 `PORT`로 오버라이드 가능). 이 인터페이스는 이후 태스크에서 그대로 재사용되므로 이름/포트 번호를 바꾸지 않는다.

이 태스크는 두 코드 변경 다 자동화된 단위테스트가 없다 (client는 애초에 테스트 러너가 구성되어
있지 않고, `createServer.ts`는 순수 게임 로직이 아니라 인프라 배선(wiring)이라 이 레포의 기존 TDD
관례 — `server/src/game/*`만 순수 함수+테스트 — 대상이 아니다). 대신 로컬에서 실제 Docker 이미지를
빌드하고 띄워서 curl로 검증하는 것이 이 태스크의 "테스트"다.

- [ ] **Step 1: `client/src/colyseus.ts`의 접속 주소를 프로덕션에서 자동 유추하도록 변경**

현재 (`client/src/colyseus.ts` 3번째 줄):
```ts
const endpoint = import.meta.env.VITE_SERVER_URL ?? "ws://localhost:2567";
```

변경 후:
```ts
const endpoint =
  import.meta.env.VITE_SERVER_URL ??
  (import.meta.env.PROD
    ? `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}`
    : "ws://localhost:2567");
```

`import.meta.env.PROD`는 Vite가 `vite build` 산출물에서 `true`로, `vite dev`에서 `false`로 자동
주입하는 값이다. 이 파일의 나머지 내용(캐싱, `joinMatch`/`leaveMatch` 등)은 전혀 건드리지 않는다.

- [ ] **Step 2: `server/src/createServer.ts`에 client 빌드 결과물 정적 서빙 추가**

현재 전체 내용:
```ts
import express from "express";
import { createServer as createHttpServer } from "http";
import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { MatchRoom } from "./rooms/MatchRoom";

export function createGameServer(): Server {
  const app = express();
  const httpServer = createHttpServer(app);
  const gameServer = new Server({
    transport: new WebSocketTransport({ server: httpServer }),
  });
  gameServer.define("match", MatchRoom);
  return gameServer;
}
```

변경 후 전체 내용:
```ts
import express from "express";
import { createServer as createHttpServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { MatchRoom } from "./rooms/MatchRoom";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDistPath = path.join(__dirname, "../public");

export function createGameServer(): Server {
  const app = express();
  app.use(express.static(clientDistPath));

  const httpServer = createHttpServer(app);
  const gameServer = new Server({
    transport: new WebSocketTransport({ server: httpServer }),
  });
  gameServer.define("match", MatchRoom);

  app.get(/.*/, (_req, res) => {
    res.sendFile(path.join(clientDistPath, "index.html"));
  });

  return gameServer;
}
```

**중요**: SPA catch-all(`app.get(/.*/, ...)`)을 `gameServer.define("match", MatchRoom)` **다음에**
등록한다 — Colyseus가 같은 `httpServer`/`app`에 매치메이킹용 HTTP 라우트(`joinOrCreate` 예약
엔드포인트 등)를 내부적으로 붙이는데, catch-all이 먼저 등록되면 그 라우트들을 가로챌 수 있다.
이 순서가 실제로 안전한지는 Step 8의 브라우저 검증에서 "역할 선택 화면까지 정상 도달하는지"로
확인한다 — 만약 매치메이킹이 깨진다면 원인은 이 순서 문제일 가능성이 가장 높다.

`clientDistPath`는 `server/public`을 가리킨다 (`server/src/createServer.ts` 기준 `../public`).
로컬 `npm run dev`는 Vite 자체 dev 서버를 쓰므로 이 폴더가 없어도 영향 없다.

- [ ] **Step 3: `Dockerfile` 작성 (레포 루트)**

```dockerfile
# --- Stage 1: client build ---
FROM node:22-slim AS client-build
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
RUN npm ci
COPY client/ client/
RUN npm run build --workspace client

# --- Stage 2: server runtime ---
FROM node:22-slim AS server
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
RUN npm ci
COPY server/ server/
COPY --from=client-build /app/client/dist ./server/public

WORKDIR /app/server
ENV PORT=2567
EXPOSE 2567
CMD ["npm", "start"]
```

- [ ] **Step 4: `.dockerignore` 작성 (레포 루트)**

```
node_modules
**/node_modules
.git
*.log
client/dist
```

- [ ] **Step 5: client 프로덕션 빌드가 타입에러 없이 되는지 로컬에서 확인**

Run: `npm run build --workspace client`
Expected: 에러 없이 종료, `client/dist/` 생성됨.

- [ ] **Step 6: Docker 이미지 빌드**

Run: `docker build -t songpyeon:test .` (레포 루트에서)
Expected: 두 스테이지 모두 성공, 최종 `songpyeon:test` 이미지 생성됨.

- [ ] **Step 7: 컨테이너를 로컬의 임시 포트(8080)로 띄워서 기동 확인**

Run: `docker run -d -p 8080:2567 --name songpyeon-test songpyeon:test`
Expected: 컨테이너가 즉시 종료되지 않고 계속 떠 있음 (`docker ps`에 보임).

Run: `docker logs songpyeon-test`
Expected: 로그에 `songpyeon server listening on ws://localhost:2567` 출력, 에러 스택트레이스 없음.

- [ ] **Step 8: 실제 브라우저로 정적 페이지 + 매치메이킹 동작 확인 (컨트롤러가 직접 수행)**

`http://localhost:8080`으로 접속해서: 페이지가 정상 로드되는지(정적 서빙 확인), "온라인" →
닉네임 입력 → 확인 → 역할 선택 화면까지 도달하는지(매치메이킹 HTTP 라우트가 catch-all에 가려지지
않았는지 확인) 확인한다. 이 프로젝트의 기존 관행대로 실제 브라우저(Playwright 등)로 확인하고,
텍스트/HTML 응답만으로 판단하지 않는다.

- [ ] **Step 9: 로컬 테스트 컨테이너 정리**

Run: `docker rm -f songpyeon-test`

- [ ] **Step 10: 커밋**

```bash
git add client/src/colyseus.ts server/src/createServer.ts Dockerfile .dockerignore
git commit -m "프로덕션 배포용 정적 서빙 + 접속주소 자동유추 + Dockerfile 추가"
```

---

### Task 2: AWS EC2 인스턴스 프로비저닝 (컨트롤러가 사용자와 함께 진행, subagent 위임 금지)

이 태스크는 코드가 아니라 AWS 콘솔 GUI 조작이므로 subagent에게 위임하지 않는다. 컨트롤러가 아래
체크리스트를 사용자에게 한 단계씩 안내하고, 사용자가 각 단계를 완료했다고 확인하면 다음 단계로
넘어간다 (사용자가 AWS 배포를 처음 해본다는 전제 — 각 용어를 짧게 설명하면서 진행).

- [ ] **Step 1: 키 페어 생성** — EC2 콘솔 → 키 페어 → 새로 생성, `.pem` 파일을 로컬에 안전한
  위치에 저장 (예: 이 프로젝트 폴더 바깥의 개인 폴더 — 저장소에 실수로 커밋되지 않도록 주의).
- [ ] **Step 2: 보안그룹 생성** — 인바운드 규칙 2개: TCP 80 소스 `0.0.0.0/0`(친구들 접속용),
  TCP 22(SSH) 소스는 콘솔의 "내 IP" 옵션으로 본인 IP만.
- [ ] **Step 3: EC2 인스턴스 런치** — AMI: Amazon Linux 2023, 타입: `t3.micro`, 스토리지: 기본
  8GB gp3 그대로, 위에서 만든 키 페어/보안그룹 선택. "고급 세부 정보" → User data에 아래 스크립트
  입력 (SSH 접속 시 바로 `docker` 명령이 되도록 자동 설치):
  ```bash
  #!/bin/bash
  dnf install -y docker
  systemctl enable --now docker
  usermod -aG docker ec2-user
  ```
- [ ] **Step 4: 퍼블릭 IP 확인** — 인스턴스가 "실행 중" 상태가 되면 콘솔에서 퍼블릭 IPv4 주소를
  확인해 컨트롤러에게 알려준다 (이후 Task 3에서 사용).
- [ ] **Step 5: Docker 설치 확인** — 컨트롤러가 `ssh -i <키.pem> ec2-user@<퍼블릭IP> docker --version`
  실행해서 User data 스크립트가 정상 동작했는지 확인 (SSH 접속에 필요한 `.pem` 경로는 사용자에게
  묻는다).

---

### Task 3: 이미지 배포 + 브라우저 최종 확인 + 정리 안내 (컨트롤러가 직접 실행)

Task 2에서 확인한 퍼블릭 IP와 `.pem` 경로를 사용한다. 각 단계는 살아있는 유료 인프라에 대한
작업이므로, `scp`/`ssh`로 실제 명령을 실행하기 전에 사용자에게 진행 여부를 확인한다.

- [ ] **Step 1: 이미지를 tar 파일로 저장**

Run: `docker save songpyeon:test -o songpyeon.tar` (Task 1의 Step 6에서 빌드한 이미지 재사용,
바뀐 코드가 없다면 재빌드 불필요)

- [ ] **Step 2: EC2로 전송**

Run: `scp -i <키.pem 경로> songpyeon.tar ec2-user@<퍼블릭IP>:~/`

- [ ] **Step 3: EC2에서 이미지 로드 + 컨테이너 실행**

Run: `ssh -i <키.pem 경로> ec2-user@<퍼블릭IP> "docker load -i songpyeon.tar && docker run -d -p 80:2567 --name songpyeon songpyeon:test"`

- [ ] **Step 4: 실제 브라우저로 최종 확인**

`http://<퍼블릭IP>`로 접속해서 온라인 모드 → 닉네임 → 역할 선택까지 실제로 확인한다 (Task 1의
Step 8과 동일한 체크리스트, 이번엔 실제 인터넷 환경에서).

- [ ] **Step 5: 친구들에게 주소 공유해서 같이 테스트**

`http://<퍼블릭IP>`를 공유하고, 4명이 모여 실제 게임 진행 — 특히 4초 타이머/동시입력 판정이 LAN
테스트 때와 다르게 느껴지는지 확인.

- [ ] **Step 6: 테스트 종료 후 정리**

EC2 콘솔에서: 나중에 다시 쓸 수도 있으면 **Stop**, 완전히 끝났으면 **Terminate**(볼륨까지 정리,
과금 완전히 중단). 인스턴스를 켜둔 채로 두면 계속 과금되므로 반드시 끄는 것을 사용자에게 상기시킨다.
