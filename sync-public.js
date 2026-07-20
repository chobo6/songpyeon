// client를 빌드해서 server/public에 복사한다. admin 페이지/구글 로그인처럼 same-origin이
// 필요한 기능을 로컬 2567 포트에서 확인할 때 씀 — dev 중 client(5173)와 server(2567)는
// 서로 다른 origin이라 쿠키 기반 세션이 안 통함 (CLAUDE.md 참고).
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const clientDist = path.join(__dirname, 'client', 'dist')
const serverPublic = path.join(__dirname, 'server', 'public')

console.log('[sync-public] client 빌드 중...')
execSync('npm run build --workspace client', { stdio: 'inherit', cwd: __dirname })

console.log('[sync-public] server/public 갱신 중...')
fs.rmSync(serverPublic, { recursive: true, force: true })
fs.cpSync(clientDist, serverPublic, { recursive: true })

console.log('[sync-public] 완료. npm run dev:server 로 서버를 (재)시작한 뒤 http://localhost:2567 에서 확인하세요.')
