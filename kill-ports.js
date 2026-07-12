// npm run dev 실행 전 2567(server)/5173(client) 포트 점유 프로세스 자동 종료
const { execSync } = require('child_process')

const PORTS = [2567, 5173]

PORTS.forEach(port => {
  try {
    if (process.platform === 'win32') {
      const out = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' })
      const listening = out.split('\n').find(l => l.includes('LISTENING'))
      if (!listening) return
      const pid = listening.trim().split(/\s+/).at(-1)
      execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' })
      console.log(`[kill-ports] 포트 ${port} 종료 (PID ${pid})`)
    } else {
      execSync(`lsof -ti :${port} | xargs kill -9`, { stdio: 'ignore' })
      console.log(`[kill-ports] 포트 ${port} 종료`)
    }
  } catch {
    // 사용 중인 프로세스 없음 — 무시
  }
})
