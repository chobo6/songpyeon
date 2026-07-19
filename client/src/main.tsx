import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AdminPage } from './components/AdminPage'

const root = createRoot(document.getElementById('root')!)

if (window.location.pathname === '/admin') {
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
