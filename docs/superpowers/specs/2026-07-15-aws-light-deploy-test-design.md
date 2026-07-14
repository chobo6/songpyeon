# AWS 라이트 배포 테스트 설계

## 배경 / 목적

지금까지는 로컬 LAN에서만 테스트해왔다. 실제 온라인 환경(친구들이 서로 다른 네트워크에서 접속)에서
게임이 어떻게 동작하는지 — 특히 지연/타이밍이 4초 타이머나 동시입력 판정에 영향을 주는지 — 확인하는
게 이번 테스트의 목적이다. 정식 서비스 배포가 아니라 **1회성 테스트**이므로, 인증서/도메인/오토스케일링
같은 프로덕션 요소는 전부 생략하고 가장 가벼운 경로로 간다.

k8s/EKS 학습은 별도 프로젝트(omok)에서 이미 진행 중이므로, songpyeon은 그 경로를 재사용하지 않고
독립적으로 가장 단순한 방식을 택한다 (`docs/todo.md`의 "배포 방식 결정" 항목에 대한 이번 프로젝트의
답: EC2 단일 인스턴스 + Docker 컨테이너 하나).

## 확정된 결정 사항

| 항목 | 결정 | 이유 |
|---|---|---|
| 도메인/TLS | 없음. `http://<EC2 퍼블릭 IP>`로 직접 접속 | 1회성 테스트, 페이지도 http라서 ws(TLS 아님)와 조합해도 브라우저 mixed-content 문제 없음 |
| 컨테이너 구성 | 단일 컨테이너 — server가 client 빌드 결과물까지 같이 서빙 | Colyseus 서버가 이미 Express 기반이라 정적 파일 서빙 추가가 쉬움. 컨테이너/포트 하나라 배포가 단순 |
| 저작권 에셋(`client/public/game-assets/`) 전달 | Docker Hub 등 제3자 레지스트리 사용 안 함. `docker save` → `scp`로 EC2에 직접 전송 | 이 폴더는 원본 게임 APK를 디컴파일해 가져온 저작권 있는 리소스라 git에도 안 올리는 중(`client/.gitignore`) — 이미지에 그대로 포함되므로 공개/비공개 여부와 무관하게 제3자 서버에 업로드하지 않는 경로를 택함 |
| EC2 운영 | 테스트 끝나면 직접 Stop 또는 Terminate | 상시 운영 아님, 과금 최소화 |
| replica 수 | 1개 고정 | `MatchRoom`이 방 상태를 메모리에 들고 있는 서버 권위형 구조라 여러 인스턴스로 늘리면 방 상태가 프로세스마다 갈라짐 (omok과 동일한 제약) |

## 코드 변경

### 1. `client/src/colyseus.ts` — 접속 주소를 프로덕션에서 자동 유추

현재:
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

- `import.meta.env.PROD`는 Vite가 `vite build` 산출물에서 자동으로 `true`를 주입하는 값 (dev 서버에서는 `false`).
- 컨테이너 하나가 정적 파일과 웹소켓을 같은 origin(같은 IP:포트)에서 서빙하므로, 브라우저가 페이지를 받아온
  `window.location.host`가 곧 서버 주소와 동일 — EC2 IP를 몰라도 이미지를 빌드할 수 있고, 나중에
  인스턴스를 Stop 후 다시 띄워 IP가 바뀌어도 이미지 재빌드가 필요 없다.
- 로컬 `npm run dev`는 `PROD`가 `false`라 기존 동작(`ws://localhost:2567`) 그대로 유지 — 이 경로는
  건드리지 않는다.

### 2. `server/src/createServer.ts` — client 빌드 결과물 정적 서빙 추가

현재:
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

변경 후 (client/dist를 정적 서빙 + SPA catch-all 추가):
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
  app.get(/.*/, (_req, res) => {
    res.sendFile(path.join(clientDistPath, "index.html"));
  });

  const httpServer = createHttpServer(app);
  const gameServer = new Server({
    transport: new WebSocketTransport({ server: httpServer }),
  });
  gameServer.define("match", MatchRoom);
  return gameServer;
}
```

- `clientDistPath`를 `server/public`으로 잡는다 — Dockerfile에서 client 빌드 결과물(`client/dist`)을
  이 경로로 복사해 넣는다 (로컬 dev에서는 이 폴더가 없어도 `npm run dev`가 Vite 자체 서버를 쓰므로 무관).
- **주의**: catch-all(`app.get(/.*/, ...)`)을 `gameServer.define()` 이전에 등록하면 Colyseus가 내부적으로
  같은 `httpServer`에 붙이는 매치메이킹 HTTP 라우트(`joinOrCreate` 등 REST 예약 엔드포인트)를 가로챌 위험이
  있다. 구현 단계에서 로컬 `docker build && docker run` 후 실제 브라우저로 접속해 매치메이킹이 정상 동작하는지
  (역할 선택 화면까지 나오는지) 반드시 확인한다 — 이 프로젝트의 기존 관행(수동 브라우저 검증)을 그대로 따른다.

### 3. `Dockerfile` (레포 루트, 신규)

**주의**: 이 레포는 npm workspaces라 `package-lock.json`이 `server/`/`client/` 안이 아니라
**레포 루트에 하나만** 존재한다. 그래서 `npm ci`는 반드시 루트에서(루트 `package.json`+
`package-lock.json`+ 각 워크스페이스의 `package.json`을 먼저 복사한 상태로) 실행해야 한다 —
`server/` 디렉터리 안에서 단독으로 `npm ci`를 돌리면 lockfile을 못 찾아 실패한다.

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

- 두 스테이지 모두 루트에서 `npm ci`를 돌리기 때문에 client/server 워크스페이스 의존성이 전부
  설치된다 — server 실행 이미지에 client 빌드 툴(vite 등)까지 같이 들어가 이미지가 다소 커지지만,
  1회성 테스트 목적이라 정확성/단순함을 이미지 크기보다 우선한다 (워크스페이스별 선택 설치는 최적화
  여지로 남겨둠, 지금은 안 함).
- server는 `npm run build`가 `tsc --noEmit`(타입체크 전용, 산출물 없음)이므로 컴파일 단계 없이 `tsx`로
  TS를 직접 실행하는 기존 `npm start`(`tsx src/index.ts`) 방식을 그대로 재사용한다. 그래서 `npm ci`가
  devDependencies(tsx, typescript)까지 전부 설치해야 함 — `--omit=dev` 쓰지 않는다.
- `node:22-slim`은 서버의 `@types/node@^22`와 맞춘 메이저 버전.
- 마지막에 `WORKDIR /app/server`로 옮겨서 `createServer.ts`의 `__dirname`(=`/app/server/src`) 기준
  `../public`이 `/app/server/public`을 가리키게 맞춘다 — `COPY --from=client-build ... ./server/public`
  (WORKDIR `/app` 기준 목적지)와 정확히 같은 경로다.

### 4. `.dockerignore` (레포 루트, 신규)

```
node_modules
**/node_modules
.git
*.log
client/dist
```

## AWS 인프라

- **EC2**: Amazon Linux 2023, `t3.micro`, 스토리지 기본 8GB gp3 그대로.
  - **User data**(런치 시 "고급 세부 정보"에 입력)로 Docker 자동 설치:
    ```bash
    #!/bin/bash
    dnf install -y docker
    systemctl enable --now docker
    usermod -aG docker ec2-user
    ```
  - 이렇게 하면 SSH 접속했을 때 바로 `docker` 명령이 동작한다 (매번 수동 설치 안 해도 됨).
- **보안그룹**:
  - 인바운드 TCP 80, 소스 `0.0.0.0/0` — 친구들이 어디서든 접속 가능해야 하므로.
  - 인바운드 TCP 22(SSH), 소스는 콘솔의 "내 IP" 옵션으로 본인 IP만.
- **키 페어**: 새로 생성해서 `.pem` 로컬에 안전하게 보관 (SSH 접속용).

## 배포 절차

**순서가 중요함** — 2번(로컬 빌드)은 EC2가 생성된 뒤든 전이든 상관없다(위 코드 변경 덕분에 IP를 몰라도
빌드 가능). 나머지는 아래 순서를 따른다.

1. EC2 인스턴스 생성 → 퍼블릭 IP 확인
2. 로컬: `docker build -t songpyeon:test .`
3. 로컬: `docker save songpyeon:test -o songpyeon.tar`
4. 로컬: `scp -i <키.pem> songpyeon.tar ec2-user@<퍼블릭IP>:~/`
5. EC2 SSH 접속 → `docker load -i songpyeon.tar` → `docker run -d -p 80:2567 --name songpyeon songpyeon:test`
6. 브라우저로 `http://<퍼블릭 IP>` 접속해서 온라인 모드 → 닉네임 → 역할 선택까지 실제로 확인
7. 친구들에게 같은 주소 공유해서 같이 테스트

## 테스트 후 정리

테스트가 끝나면 EC2 콘솔에서:
- 나중에 다시 쓸 수도 있으면 **Stop**
- 완전히 끝났으면 **Terminate** (볼륨까지 정리, 과금 완전히 중단)

인스턴스를 켜둔 채로 두면 계속 과금되므로 반드시 끄는 것을 잊지 않는다.

## 스코프 제외 (명시적으로 안 함)

- 도메인 구매, HTTPS/TLS 인증서 (Caddy 등)
- Docker Hub/ECR 등 이미지 레지스트리
- 오토스케일링, 헬스체크, 로드밸런서
- CI/CD 자동 배포 파이프라인
- RDS 등 외부 DB (애초에 이 프로젝트는 DB를 안 씀 — 방 상태는 메모리에만 존재)
- k8s/EKS (omok 프로젝트에서 별도로 학습 중)
