import React, { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Routes, Route } from 'react-router-dom'
import Login from './pages/Login/Login.jsx'
import EmailView from './pages/EmailView/EmailView.jsx'

// Relay console logs to the main process terminal for easier debugging
if (window.electronAPI && window.electronAPI.logToMain) {
  const origLog = console.log
  const origWarn = console.warn
  const origError = console.error
  console.log = (...args) => { origLog(...args); window.electronAPI.logToMain('log', ...args) }
  console.warn = (...args) => { origWarn(...args); window.electronAPI.logToMain('warn', ...args) }
  console.error = (...args) => { origError(...args); window.electronAPI.logToMain('error', ...args) }
}

import { VoiceProvider } from './context/VoiceContext.jsx'

const container = document.getElementById('root')
const root = createRoot(container)

root.render(
  <StrictMode>
    <VoiceProvider>
      <HashRouter>
        <Routes>
          <Route path="/" element={<Login />} />
          <Route path="/emails" element={<EmailView />} />
        </Routes>
      </HashRouter>
    </VoiceProvider>
  </StrictMode>,
)
