'use client'

import { useCallback, useEffect, useRef, useState, FormEvent } from 'react'
import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { LanguageSwitcherSelect } from '@/components/ui/language-switcher'
import { NetworkBackground } from '@/components/ui/network-background'
import { STORAGE_GATEWAY_URL } from '@/lib/device-identity'

interface GoogleCredentialResponse {
  credential?: string
}

interface GoogleAccountsIdApi {
  initialize(config: {
    client_id: string
    callback: (response: GoogleCredentialResponse) => void
  }): void
  prompt(): void
}

interface GoogleApi {
  accounts: {
    id: GoogleAccountsIdApi
  }
}

type LoginRequestBody =
  | { username: string; password: string }
  | { credential?: string }

type LoginErrorPayload = {
  code?: string
  error?: string
  hint?: string
}

function readLoginErrorPayload(value: unknown): LoginErrorPayload {
  if (!value || typeof value !== 'object') return {}
  const record = value as Record<string, unknown>
  return {
    code: typeof record.code === 'string' ? record.code : undefined,
    error: typeof record.error === 'string' ? record.error : undefined,
    hint: typeof record.hint === 'string' ? record.hint : undefined,
  }
}

declare global {
  interface Window {
    google?: GoogleApi
  }
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 001 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  )
}

const GATEWAY_URL_PRESETS = [
  'ws://127.0.0.1:18789',
  'wss://127.0.0.1:18789',
  'ws://localhost:18789',
  'wss://localhost:18789',
  'wss://gateway:18789',
]

const GATEWAY_CONNECTION_TIMEOUT_MS = 5000

type ConnectionStatus = 'idle' | 'testing' | 'success' | 'failed'

export default function LoginPage() {
  const t = useTranslations('auth')
  const tc = useTranslations('common')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [pendingApproval, setPendingApproval] = useState(false)
  const [needsSetup, setNeedsSetup] = useState(false)
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [googleReady, setGoogleReady] = useState(false)
  const googleCallbackRef = useRef<((response: GoogleCredentialResponse) => void) | null>(null)

  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [gatewayPreset, setGatewayPreset] = useState<string>(() => {
    if (typeof window !== 'undefined' && window.location.protocol === 'https:') {
      return 'wss://127.0.0.1:18789'
    }
    return 'ws://127.0.0.1:18789'
  })
  const [gatewayCustom, setGatewayCustom] = useState('')
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('idle')
  const [connectionError, setConnectionError] = useState('')

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_GATEWAY_URL)
    if (saved) {
      if (GATEWAY_URL_PRESETS.includes(saved)) {
        setGatewayPreset(saved)
      } else {
        setGatewayPreset('custom')
        setGatewayCustom(saved)
      }
    }
  }, [])

  const getEffectiveGatewayUrl = (): string => {
    return gatewayPreset === 'custom' ? gatewayCustom.trim() : gatewayPreset
  }

  const handleGatewayUrlChange = (value: string) => {
    setGatewayPreset(value)
    if (value !== 'custom') {
      localStorage.setItem(STORAGE_GATEWAY_URL, value)
      setConnectionStatus('idle')
    }
  }

  const handleGatewayCustomChange = (value: string) => {
    setGatewayCustom(value)
    const trimmed = value.trim()
    if (trimmed) {
      localStorage.setItem(STORAGE_GATEWAY_URL, trimmed)
      setConnectionStatus('idle')
    }
  }

  const handleTestConnection = () => {
    const url = getEffectiveGatewayUrl()
    if (!url) return
    setConnectionStatus('testing')
    setConnectionError('')

    return new Promise<void>((resolve) => {
      try {
        const ws = new WebSocket(url)
        const timeout = setTimeout(() => {
          ws.close()
          setConnectionStatus('failed')
          setConnectionError('Connection timed out')
          resolve()
        }, GATEWAY_CONNECTION_TIMEOUT_MS)

        ws.onopen = () => {
          clearTimeout(timeout)
          ws.close()
          setConnectionStatus('success')
          resolve()
        }

        ws.onerror = () => {
          clearTimeout(timeout)
          ws.close()
          setConnectionStatus('failed')
          setConnectionError('Could not connect')
          resolve()
        }
      } catch {
        setConnectionStatus('failed')
        setConnectionError('Invalid URL')
        resolve()
      }
    })
  }

  const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || ''

  useEffect(() => {
    fetch('/api/setup')
      .then((res) => res.json())
      .then((data) => {
        if (data.needsSetup) {
          window.location.href = '/setup'
        }
      })
      .catch(() => {})
  }, [])

  const completeLogin = useCallback(async (path: string, body: LoginRequestBody) => {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const data = readLoginErrorPayload(await res.json().catch(() => null))
      if (data.code === 'PENDING_APPROVAL') {
        setPendingApproval(true)
        setNeedsSetup(false)
        setError('')
        setLoading(false)
        setGoogleLoading(false)
        return false
      }
      if (data.code === 'NO_USERS') {
        setNeedsSetup(true)
        setError('')
        setLoading(false)
        setGoogleLoading(false)
        return false
      }
      setError(data.error || t('loginFailed'))
      setPendingApproval(false)
      setNeedsSetup(false)
      setLoading(false)
      setGoogleLoading(false)
      return false
    }

    window.location.href = '/'
    return true
  }, [t])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const form = e.target as HTMLFormElement
    const formUsername = (form.elements.namedItem('username') as HTMLInputElement)?.value || username
    const formPassword = (form.elements.namedItem('password') as HTMLInputElement)?.value || password

    try {
      await completeLogin('/api/auth/login', { username: formUsername, password: formPassword })
    } catch {
      setError(t('networkError'))
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!googleClientId) return

    const onScriptLoad = () => {
      if (!window.google) return
      googleCallbackRef.current = async (response: GoogleCredentialResponse) => {
        setError('')
        setGoogleLoading(true)
        try {
          const ok = await completeLogin('/api/auth/google', { credential: response?.credential })
          if (!ok) return
        } catch {
          setError(t('googleSignInFailed'))
          setGoogleLoading(false)
        }
      }
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: (response: GoogleCredentialResponse) => googleCallbackRef.current?.(response),
      })
      setGoogleReady(true)
    }

    const existing = document.querySelector('script[data-google-gsi="1"]') as HTMLScriptElement | null
    if (existing) {
      if (window.google) onScriptLoad()
      return
    }

    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.setAttribute('data-google-gsi', '1')
    script.onload = onScriptLoad
    script.onerror = () => setError(t('googleSignInFailed'))
    document.head.appendChild(script)
  }, [googleClientId, completeLogin, t])

  const handleGoogleSignIn = () => {
    if (!window.google || !googleReady) return
    window.google.accounts.id.prompt()
  }

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden">
      <NetworkBackground />

      {/* Language selector - corner, subtle */}
      <div className="absolute top-4 right-4 z-20 opacity-60 hover:opacity-100 transition-opacity duration-300">
        <LanguageSwitcherSelect />
      </div>

      {/* Main glass card */}
      <div className="relative z-10 w-full max-w-[420px] mx-4 sm:mx-6">
        {/* Glow ring */}
        <div className="absolute -inset-[1px] rounded-2xl bg-gradient-to-br from-void-cyan/20 via-transparent to-void-violet/15 blur-sm pointer-events-none" />

        <div className="relative bg-card/75 backdrop-blur-xl border border-border/60 rounded-2xl shadow-2xl overflow-hidden"
          style={{
            boxShadow: `
              0 4px 24px hsl(215 27% 4% / 0.6),
              0 0 0 1px hsl(var(--void-cyan) / 0.04),
              inset 0 1px 0 hsl(var(--void-cyan) / 0.03)
            `,
          }}
        >
          {/* Top decorative line */}
          <div className="h-px w-full bg-gradient-to-r from-transparent via-void-cyan/20 to-transparent" />

          <div className="px-6 sm:px-8 pt-8 pb-6">
            {/* Logo + title */}
            <div className="flex flex-col items-center mb-8">
              <div className="relative mb-4">
                <div className="absolute inset-0 rounded-xl bg-void-cyan/10 blur-xl animate-pulse" />
                <div className="relative w-16 h-16 rounded-xl overflow-hidden bg-card border border-border/60 flex items-center justify-center shadow-lg">
                  <Image
                    src="/brand/mc-logo-128.png"
                    alt="Mission Control logo"
                    width={56}
                    height={56}
                    className="h-full w-full object-cover"
                    priority
                  />
                </div>
              </div>
              <h1 className="text-2xl font-semibold text-foreground tracking-tight">{t('missionControl')}</h1>
              <p className="text-sm text-muted-foreground mt-1">{t('signInToContinue')}</p>
            </div>

            {/* Status banners */}
            {pendingApproval && (
              <div className="mb-5 p-4 rounded-xl bg-amber-500/8 border border-amber-500/15 text-center">
                <div className="flex justify-center mb-2">
                  <svg className="w-8 h-8 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12,6 12,12 16,14" />
                  </svg>
                </div>
                <div className="text-sm font-medium text-amber-200">{t('accessRequestSubmitted')}</div>
                <p className="text-xs text-muted-foreground mt-1">{t('accessRequestDescription')}</p>
                <Button
                  onClick={() => { setPendingApproval(false); setError(''); setGoogleLoading(false) }}
                  variant="ghost"
                  size="sm"
                  className="mt-3 text-xs"
                >
                  {t('tryAgain')}
                </Button>
              </div>
            )}

            {needsSetup && (
              <div className="mb-5 p-4 rounded-xl bg-blue-500/8 border border-blue-500/15 text-center">
                <div className="flex justify-center mb-2">
                  <svg className="w-8 h-8 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                </div>
                <div className="text-sm font-medium text-blue-200">{t('noAdminAccount')}</div>
                <p className="text-xs text-muted-foreground mt-1">{t('noAdminDescription')}</p>
                <Button
                  onClick={() => { window.location.href = '/setup' }}
                  size="sm"
                  className="mt-3"
                >
                  {t('createAdminAccount')}
                </Button>
              </div>
            )}

            {error && (
              <div role="alert" className="mb-5 p-3 rounded-xl bg-destructive/8 border border-destructive/15 text-sm text-destructive">
                {error}
              </div>
            )}

            {/* Advanced Settings */}
            <div className="mb-5 rounded-xl border border-border/40 overflow-hidden">
              <button
                type="button"
                onClick={() => setAdvancedOpen(o => !o)}
                className="w-full px-3 py-2.5 flex items-center justify-between text-sm text-muted-foreground hover:text-foreground hover:bg-secondary/30 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="8" cy="8" r="1.5" />
                    <path d="M8 3.5V5M8 11v1.5M3.5 8H5M11 8h1.5M4.93 4.93l1.06 1.06M9.99 9.99l1.06 1.06M4.93 11.07l1.06-1.06M9.99 6.01l1.06-1.06" />
                  </svg>
                  {t('advancedSettings')}
                </span>
                <svg
                  className={`w-4 h-4 transition-transform duration-300 ${advancedOpen ? 'rotate-180' : ''}`}
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4 6l4 4 4-4" />
                </svg>
              </button>

              {advancedOpen && (
                <div className="px-3 pb-3 pt-1 space-y-3 border-t border-border/40 bg-secondary/20">
                  <div>
                    <label htmlFor="gateway-url" className="block text-sm font-medium text-foreground mb-1.5">
                      {t('gatewayUrl')}
                    </label>
                    <div className="flex gap-2">
                      <select
                        id="gateway-url"
                        value={gatewayPreset}
                        onChange={e => handleGatewayUrlChange(e.target.value)}
                        className="flex-1 h-10 px-3 rounded-lg bg-secondary border border-border/60 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-smooth appearance-none cursor-pointer"
                      >
                        {GATEWAY_URL_PRESETS.map(url => (
                          <option key={url} value={url}>{url}</option>
                        ))}
                        <option value="custom">Custom</option>
                      </select>
                    </div>
                    {gatewayPreset === 'custom' && (
                      <input
                        type="text"
                        value={gatewayCustom}
                        onChange={e => handleGatewayCustomChange(e.target.value)}
                        placeholder={t('gatewayUrlPlaceholder')}
                        className="mt-2 w-full h-10 px-3 rounded-lg bg-secondary border border-border/60 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-smooth"
                      />
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleTestConnection}
                      disabled={connectionStatus === 'testing' || !getEffectiveGatewayUrl()}
                      className="h-9 px-3 rounded-lg bg-secondary border border-border/60 text-foreground text-sm hover:bg-muted-foreground/10 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                    >
                      {connectionStatus === 'testing' ? (
                        <>
                          <div className="w-3.5 h-3.5 border-2 border-muted-foreground/40 border-t-muted-foreground rounded-full animate-spin" />
                          {t('testConnection')}...
                        </>
                      ) : (
                        <>
                          <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M13.5 2.5L2.5 13.5M13.5 2.5l-4 4m4-4l-4-4m4 4l-4 4" />
                          </svg>
                          {t('testConnection')}
                        </>
                      )}
                    </button>

                    {connectionStatus === 'success' && (
                      <span className="text-xs text-green-400 flex items-center gap-1">
                        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M13 3L6 10l-3-3" />
                        </svg>
                        {t('connectionSuccess')}
                      </span>
                    )}
                    {connectionStatus === 'failed' && (
                      <span className="text-xs text-destructive flex items-center gap-1">
                        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 4L4 12M4 4l8 8" />
                        </svg>
                        {t('connectionFailed')}{connectionError ? `: ${connectionError}` : ''}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Google Sign-In */}
            {googleClientId && (
              <div className={pendingApproval ? 'opacity-50 pointer-events-none' : ''}>
                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={!googleReady || googleLoading || loading}
                  className="w-full h-11 flex items-center justify-center gap-3 rounded-xl border border-border/60 bg-surface-1 text-foreground text-sm font-medium hover:bg-surface-2 hover:border-border transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {googleLoading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-foreground/20 border-t-void-cyan rounded-full animate-spin" />
                      {t('signingIn')}
                    </>
                  ) : (
                    <>
                      <GoogleIcon className="w-[18px] h-[18px]" />
                      {t('signInWithGoogle')}
                    </>
                  )}
                </button>
                {!googleReady && (
                  <div className="text-center text-xs text-muted-foreground mt-2 flex items-center justify-center gap-1.5">
                    <span className="w-3 h-3 border border-foreground/10 border-t-void-cyan/60 rounded-full animate-spin" />
                    {t('loadingGoogleSignIn')}
                  </div>
                )}

                <div className="my-5 flex items-center gap-3">
                  <div className="h-px flex-1 bg-gradient-to-r from-transparent to-border/50" />
                  <span className="text-[11px] text-muted-foreground uppercase tracking-wider">{tc('or')}</span>
                  <div className="h-px flex-1 bg-gradient-to-l from-transparent to-border/50" />
                </div>
              </div>
            )}

            {/* Local login form */}
            <form onSubmit={handleSubmit} className={`space-y-4 ${pendingApproval ? 'opacity-50 pointer-events-none' : ''}`}>
              <div>
                <label htmlFor="username" className="block text-sm font-medium text-foreground mb-1.5">{t('username')}</label>
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full h-11 px-4 rounded-xl bg-secondary/60 border border-border/40 text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30 transition-smooth"
                  placeholder={t('enterUsername')}
                  autoComplete="username"
                  autoFocus
                  required
                  aria-required="true"
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-foreground mb-1.5">{t('password')}</label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full h-11 px-4 rounded-xl bg-secondary/60 border border-border/40 text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30 transition-smooth"
                  placeholder={t('enterPassword')}
                  autoComplete="current-password"
                  required
                  aria-required="true"
                />
              </div>

              <Button
                type="submit"
                disabled={loading}
                size="lg"
                className="w-full rounded-xl h-11 text-sm font-semibold tracking-wide"
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                    {t('signingIn')}
                  </>
                ) : (
                  t('signIn')
                )}
              </Button>
            </form>
          </div>

          {/* Footer */}
          <div className="px-6 sm:px-8 pb-6 pt-2">
            <div className="flex items-center justify-center gap-2">
              <div className="h-px w-8 bg-gradient-to-r from-transparent to-border/40" />
              <p className="text-center text-[11px] text-muted-foreground tracking-wide">{t('orchestrationTagline')}</p>
              <div className="h-px w-8 bg-gradient-to-l from-transparent to-border/40" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
