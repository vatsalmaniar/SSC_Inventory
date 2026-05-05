import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/global.css'
import './styles/theme.css'
import App from './App.jsx'

// Apply saved theme on load (before React renders, prevents flash)
const savedTheme = localStorage.getItem('ssc-theme')
if (savedTheme === 'dark') document.documentElement.setAttribute('data-theme', 'dark')

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
