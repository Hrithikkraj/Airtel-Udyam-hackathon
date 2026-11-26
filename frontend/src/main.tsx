import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { LanguageProvider } from './LanguageProvider'
import MotionProvider from './ui/MotionProvider'
import { ToastProvider } from './ui/Toast'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LanguageProvider>
      <MotionProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </MotionProvider>
    </LanguageProvider>
  </StrictMode>,
)
