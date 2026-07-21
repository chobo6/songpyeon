import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AdminPage } from './components/AdminPage'

const rootEl = document.getElementById('root')!
const root = createRoot(rootEl)

if (window.location.pathname === '/admin') {
  // 게임 화면 전용인 #root의 480px 고정폭/다크 배경/text-align:center를
  // 관리자 페이지에는 적용하지 않기 위한 표시 — index.css의 #root.admin-root 참고.
  rootEl.classList.add('admin-root')
  root.render(
    <StrictMode>
      <AdminPage />
    </StrictMode>,
  )
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
