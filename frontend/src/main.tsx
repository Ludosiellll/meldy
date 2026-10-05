import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import './styles/legacy.css'
import { AuthProvider } from './contexts/AuthContext'
import { ConfirmProvider } from './contexts/ConfirmContext'
import { ThemeProvider } from './contexts/ThemeProvider'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { installApiAuth } from './lib/apiAuth'
import { installTelemetry } from './lib/telemetry'
import { AILimitDialogHost } from './hooks/useEnergyConfirm'
import { AppErrorBoundary } from './components/AppErrorBoundary'

const queryClient = new QueryClient()
installApiAuth()
// Meldy's own statistics and error reports (lib/telemetry, docs/analytics.md): page views, errors, batched sends.
installTelemetry()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* An error no screen caught: one calm card with «Перезагрузить страницу», and an error report. */}
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider defaultTheme="system" storageKey="studyforge-theme">
          <AuthProvider>
            <ConfirmProvider>
              {/* The daily AI limit refused by the server (429 ai_limit) opens one dialog app-wide. */}
              <AILimitDialogHost />
              <App />
            </ConfirmProvider>
          </AuthProvider>
        </ThemeProvider>
        <ReactQueryDevtools initialIsOpen={false} />
      </QueryClientProvider>
    </AppErrorBoundary>
  </React.StrictMode>,
)
