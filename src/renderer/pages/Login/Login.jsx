import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

// FOR TESTING ONLY. Set to false otherwise.
// This bypasses needing to log in and used demo emails instead.
const BYPASS_LOGIN_FOR_DEMO = false

const CARD_SHADOW =
  '-4px 5px 15px rgba(0,0,0,.23),' +
  '-17px 22px 28px rgba(0,0,0,.20),' +
  '-38px 49px 37px rgba(0,0,0,.12),' +
  '-68px 87px 44px rgba(0,0,0,.03)'

const BUTTON_SHADOW =
  '0px 1px 3px rgba(0,0,0,.10),' +
  '0px 5px 5px rgba(0,0,0,.09),' +
  '0px 12px 7px rgba(0,0,0,.05),' +
  '0px 21px 8px rgba(0,0,0,.01),' +
  '0px 33px 9px rgba(0,0,0,0)'

function OrDivider() {
  return (
    <div style={{ position: 'relative', width: 429, height: 48, flexShrink: 0 }}>
      <div
        style={{
          position: 'absolute',
          top: 24,
          left: 0,
          right: 0,
          height: 1,
          background: '#D5D7DA',
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          background: '#fff',
          padding: '10px 10px',
          lineHeight: '28px',
          fontSize: 18,
          fontWeight: 500,
          color: '#717680',
        }}
      >
        OR
      </div>
    </div>
  )
}

function StatusBanner({ type, errorMsg }) {
  const isSuccess = type === 'success'
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        width: 430,
        minHeight: 66,
        borderRadius: 16,
        background: isSuccess ? '#ECFDF3' : '#FEF3F2',
        paddingLeft: 4,
        paddingRight: isSuccess ? 10 : 12,
        paddingTop: 4,
        paddingBottom: 4,
        flexShrink: 0,
      }}
    >
      <div
        style={{
          background: '#fff',
          border: `1px solid ${isSuccess ? '#A6F4C5' : '#FECDCA'}`,
          borderRadius: 16,
          padding: '2px 10px',
          fontSize: 20,
          fontWeight: 700,
          lineHeight: '30px',
          color: isSuccess ? '#027A48' : '#B42318',
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
      >
        {isSuccess ? 'Access' : 'Error'}
      </div>
      <span
        style={{
          fontSize: 13,
          fontWeight: 600,
          lineHeight: '20px',
          color: isSuccess ? '#027A48' : '#B42318',
          wordBreak: 'break-word',
          whiteSpace: 'normal',
        }}
      >
        {isSuccess
          ? 'Login successful. Please wait...'
          : (errorMsg || 'Login failed. Please try again.')}
      </span>
    </div>
  )
}

export default function Login() {
  const navigate = useNavigate()
  const [status, setStatus] = useState(null)
  const [errorMsg, setErrorMsg] = useState('')
  // null | 'loading-google' | 'loading-yahoo' | 'success' | 'error'

  useEffect(() => {
    if (BYPASS_LOGIN_FOR_DEMO) {
      navigate('/emails', {
        replace: true,
        state: {
          provider: 'demo',
          email: 'demo@audioemailer.local',
        },
      })
      return
    }

    async function checkAuth() {
      try {
        const api = window.electronAPI
        if (api && api.getGoogleAccount) {
          const acct = await api.getGoogleAccount()
          if (acct && acct.email) {
            console.log('[Login] Auto-redirecting for:', acct.email)
            navigate('/emails', { replace: true, state: { provider: 'google', email: acct.email } })
          }
        }
      } catch (err) {
        console.error('[Login] checkAuth error:', err)
      }
    }
    checkAuth()
  }, [navigate])

  const isLoading =
    status === 'loading-google' ? 'google' :
      status === 'loading-yahoo' ? 'yahoo' : null

  async function handleLogin(provider) {
    const isGoogle = provider === 'google'
    const api = window.electronAPI

    if (!api || !api.googleLogin) {
      console.error('[Login] window.electronAPI not available. api=', api)
      setErrorMsg('electronAPI not available — preload may have failed.')
      setStatus('error')
      return
    }

    setStatus(isGoogle ? 'loading-google' : 'loading-yahoo')

    try {
      let result
      if (isGoogle) {
        result = await api.googleLogin()
      } else {
        if (!api.yahooLogin) {
          setErrorMsg('yahooLogin not exposed by preload.')
          setStatus('error')
          return
        }
        result = await api.yahooLogin()
      }

      console.log('[Login] IPC result:', result)

      if (result && result.status === 'ok' && result.hasToken) {
        setStatus('success')
        setTimeout(() => {
          navigate('/emails', { state: { provider, email: result.email } })
        }, 800)
      } else {
        const msg = result?.error || 'Login did not return a token.'
        console.error('[Login] Auth failed:', msg, result)
        setErrorMsg(msg)
        setStatus('error')
      }
    } catch (err) {
      console.error('[Login] IPC error during', provider, 'login:', err)
      setErrorMsg(err?.message || String(err))
      setStatus('error')
    }
  }

  return (
    <>
      <style>{`
        @keyframes loginFadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes bannerPop {
          0%   { opacity: 0; transform: scale(0.85) translateY(-6px); }
          70%  { transform: scale(1.02) translateY(1px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        .login-card { animation: loginFadeIn 0.3s ease-out both; }
        .banner-pop { animation: bannerPop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) both; }
        .social-btn:hover:not(:disabled) { background: #F9FAFB !important; }
        .social-btn:disabled { opacity: 0.6; cursor: not-allowed; }
      `}</style>

      <div
        style={{
          minHeight: '100vh',
          background: '#FFFFFF',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          className="login-card"
          style={{
            width: 480,
            background: '#fff',
            border: '0.67px solid #F5F5F5',
            borderRadius: 10,
            boxShadow: CARD_SHADOW,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            overflow: 'hidden',
            paddingTop: 40,
            paddingBottom: 48,
            paddingLeft: 40,
            paddingRight: 40,
            gap: 24,
          }}
        >
          {/* Logo (image asset) */}
          <div style={{ height: 64, display: 'flex', justifyContent: 'center', alignItems: 'flex-start' }}>
            <img
              src="./icons/LoginLogo.png"
              alt="Audio Emailer"
              width={64}
              height={64}
              style={{
                borderRadius: 14,
                boxShadow: '0px 1px 2px -1px rgba(0, 0, 0, 0.10), 0px 1px 3px rgba(0, 0, 0, 0.10)',
              }}
            />
          </div>

          {/* Title */}
          <div style={{ position: 'relative', height: 45, width: '100%' }}>
            <div
              style={{
                position: 'absolute',
                inset: 0,
                textAlign: 'center',
                color: '#1C1E21',
                fontSize: 30,
                fontFamily: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif',
                fontWeight: 700,
                lineHeight: '45px',
              }}
            >
              Audio Emailer
            </div>
          </div>

          {/* Subtitle */}
          <div
            style={{
              width: '100%',
              display: 'flex',
              justifyContent: 'center',
              marginTop: -4,
            }}
          >
            <div
              style={{
                color: '#65676B',
                fontSize: 16,
                fontFamily: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif',
                fontWeight: 400,
                lineHeight: '24px',
              }}
            >
              Sign in to your account
            </div>
          </div>

          {/* Status banner */}
          {(status === 'success' || status === 'error') && (
            <div className="banner-pop">
              <StatusBanner type={status === 'success' ? 'success' : 'error'} errorMsg={errorMsg} />
            </div>
          )}

          {/* Google button */}
          <button
            className="social-btn"
            onClick={() => handleLogin('google')}
            disabled={!!isLoading}
            style={{
              marginTop: status === 'success' || status === 'error' ? 8 : 16,
              width: 429,
              height: 44,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              background: '#fff',
              border: '1px solid #717680',
              borderRadius: 8,
              boxShadow: BUTTON_SHADOW,
              cursor: isLoading ? 'not-allowed' : 'pointer',
              padding: '10px 16px',
              flexShrink: 0,
            }}
          >
            <img src="./icons/Google.svg" alt="Google" width={24} height={24} style={{ flexShrink: 0 }} />
            <span
              style={{
                fontSize: 16,
                fontWeight: 600,
                lineHeight: '24px',
                color: '#414651',
                whiteSpace: 'nowrap',
              }}
            >
              Sign in with Google
            </span>
          </button>

          {/* OR divider */}
          <div>
            <OrDivider />
          </div>

          {/* Yahoo button */}
          <button
            className="social-btn"
            onClick={() => handleLogin('yahoo')}
            disabled={!!isLoading}
            style={{
              width: 429,
              height: 44,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              background: '#fff',
              border: '1px solid #717680',
              borderRadius: 8,
              boxShadow: BUTTON_SHADOW,
              cursor: isLoading ? 'not-allowed' : 'pointer',
              padding: '10px 16px',
              flexShrink: 0,
            }}
          >
            <img src="./icons/Yahoo.svg" alt="Yahoo" width={24} height={24} style={{ flexShrink: 0 }} />
            <span
              style={{
                fontSize: 16,
                fontWeight: 600,
                lineHeight: '24px',
                color: '#414651',
                whiteSpace: 'nowrap',
              }}
            >
              Sign in with Yahoo
            </span>
          </button>
        </div>
      </div>
    </>
  )
}
