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
import { AILimitDialogHost } from './hooks/useEnergyConfirm'

const queryClient = new QueryClient()
installApiAuth()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
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
  </React.StrictMode>,
)
