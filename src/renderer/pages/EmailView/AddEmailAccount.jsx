import { useState } from 'react'
import { CloseIcon } from '../../components/icons'

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBanner({ status, errorMessage }) {
  if (status !== 'success' && status !== 'error') return null

  const isSuccess = status === 'success'
  return (
    <div className={`status-banner ${isSuccess ? 'success' : 'error'}`}>
      <span className="status-badge">{isSuccess ? 'Access' : 'Failure'}</span>
      <span className="status-banner-text">
        {isSuccess
          ? 'Add account successful. Please wait…'
          : (errorMessage || 'Add account failed. Please try again.')}
      </span>
    </div>
  )
}

function SocialButton({ provider, onClick, disabled }) {
  const isGoogle = provider === 'google'
  return (
    <button
      type="button"
      className="add-account-social-btn"
      onClick={onClick}
      disabled={disabled}
    >
      <img
        src={isGoogle ? './icons/Google.svg' : './icons/Yahoo.svg'}
        alt={isGoogle ? 'Google' : 'Yahoo'}
        width={20}
        height={20}
      />
      {isGoogle ? 'Add account with Google' : 'Add account with Yahoo'}
    </button>
  )
}

function OrDivider() {
  return (
    <div className="add-account-or-divider">
      <span className="add-account-or-text">OR</span>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function AddEmailAccount({ onClose, onSave }) {
  const [authStatus, setAuthStatus] = useState('idle') // idle | loading | success | error
  const [loadingProvider, setLoadingProvider] = useState(null) // 'google' | 'yahoo' | null
  const [errorMessage, setErrorMessage] = useState('')

  const isLocked = authStatus === 'loading' || authStatus === 'success'

  function handleClose() {
    if (authStatus === 'loading') return
    onClose()
  }

  async function handleAdd(provider) {
    const isGoogle = provider === 'google'
    const api = window.electronAPI
    if (!api || (isGoogle && !api.googleLogin) || (!isGoogle && !api.yahooLogin)) {
      setErrorMessage(
        'Cannot reach the app shell: run this app in Electron (browser preview does not expose googleLogin / yahooLogin).'
      )
      setAuthStatus('error')
      return
    }

    setLoadingProvider(provider)
    setAuthStatus('loading')
    setErrorMessage('')
    try {
      const loginFn = isGoogle ? api.googleLogin : api.yahooLogin
      const result = await loginFn()
      if (result?.status === 'ok' && result.hasToken) {
        setAuthStatus('success')
        setTimeout(() => {
          onSave({ email: result.email ?? '', provider })
          onClose()
        }, 1500)
      } else {
        setAuthStatus('error')
        setErrorMessage(result?.error || 'Login did not return a token.')
      }
    } catch (err) {
      setAuthStatus('error')
      setErrorMessage(err?.message || String(err))
    } finally {
      setLoadingProvider(null)
    }
  }

  return (
    <div
      className="add-account-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) handleClose()
      }}
    >
      <div
        className="add-account-modal"
        onClick={e => e.stopPropagation()}
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="add-account-header">
          <div className="add-account-header-text">
            <h2>Add Email Account</h2>
            <p>Connect your email account to Audio Emailer</p>
          </div>
          <button type="button" className="add-account-close" onClick={handleClose}>
            <CloseIcon size={16} />
          </button>
        </div>

        {/* Status Banner */}
        <StatusBanner status={authStatus} errorMessage={errorMessage} />

        {/* Body */}
        <div className="add-account-body">
          <SocialButton
            provider="google"
            onClick={() => handleAdd('google')}
            disabled={isLocked}
          />
          <OrDivider />
          <SocialButton
            provider="yahoo"
            onClick={() => handleAdd('yahoo')}
            disabled={isLocked}
          />
        </div>
      </div>
    </div>
  )
}
