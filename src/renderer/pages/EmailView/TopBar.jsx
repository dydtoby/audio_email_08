/**
 * TopBar renders the global header for the email view, including theme toggle,
 * account menu, linked-account actions, and logout. Theme state is owned by
 * EmailView and passed in as props so the Settings page can share it.
 */
import { useRef, useState, useEffect } from 'react'
import {
  SunIcon, MoonIcon, ChevronDownIcon,
  AddIcon, LogoutIcon, TrashIcon,
} from '../../components/icons'

export function TopBar({ accountEmail, effectiveProvider, linkedAccounts, setLinkedAccounts, onLogout, onAddAccount, theme, onThemeChange }) {
  const [showUserMenu, setShowUserMenu] = useState(false)
  const userMenuRef = useRef(null)

  const avatarLetter = (accountEmail || effectiveProvider || 'U')[0].toUpperCase()

  // Close user menu on outside click
  useEffect(() => {
    function handler(e) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target))
        setShowUserMenu(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <header className="topbar">
      <div className="topbar-left">
        <img
          src={theme === 'dark' ? './icons/Logo-Dark.png' : './icons/Logo-Light.png'}
          alt="Audio Emailer"
          style={{ height: 34, width: 'auto' }}
        />
      </div>
      <div className="topbar-right">
        <button
          className="icon-btn"
          aria-label="Toggle theme"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          onClick={() => onThemeChange(theme === 'dark' ? 'light' : 'dark')}
        >
          {theme === 'dark' ? <SunIcon size={20} /> : <MoonIcon size={20} />}
        </button>
        <div className="user-menu-wrapper" ref={userMenuRef}>
          <div
            className="profile-chip"
            title={`Signed in as ${accountEmail || effectiveProvider}`}
            onClick={() => setShowUserMenu(prev => !prev)}
          >
            <div className="avatar">{avatarLetter}</div>
            <span style={{ display: 'flex', transition: 'transform 0.2s', transform: showUserMenu ? 'rotate(180deg)' : 'none' }}>
              <ChevronDownIcon size={16} />
            </span>
          </div>
          {showUserMenu && (
            <div className="user-dropdown">
              <div className="dropdown-section-label">Accounts</div>
              <div className="dropdown-account-primary">
                <div className="avatar">{avatarLetter}</div>
                <div className="account-text-area">
                  <div className="dropdown-account-email">{accountEmail || effectiveProvider || 'Demo Inbox'}</div>
                  <div className="dropdown-account-provider">{effectiveProvider || 'demo'}</div>
                </div>
              </div>
              {linkedAccounts.map(acct => (
                <div key={acct.id} className="dropdown-account-linked">
                  <div className="avatar" style={{ background: acct.color, width: 32, height: 32, fontSize: 13, flexShrink: 0 }}>
                    {acct.email[0].toUpperCase()}
                  </div>
                  <div className="account-text-area-linked">
                    <div className="dropdown-account-email">{acct.email}</div>
                    <div className="dropdown-account-provider">{acct.provider}</div>
                  </div>
                  <button
                    className="linked-delete-btn"
                    onClick={e => {
                      e.stopPropagation()
                      if (window.confirm(`Remove linked account ${acct.email}?`))
                        setLinkedAccounts(prev => prev.filter(a => a.id !== acct.id))
                    }}
                  >
                    <TrashIcon size={16} color="currentColor" />
                  </button>
                </div>
              ))}
              <div className="dropdown-divider" />
              <button
                type="button"
                className="dropdown-item dropdown-item--add"
                aria-label="Add another account for multi-account inbox (Google or Yahoo)"
                onClick={() => {
                  setShowUserMenu(false)
                  // Defer so the dropdown unmount does not swallow the click / focus in some environments.
                  queueMicrotask(() => {
                    onAddAccount?.()
                  })
                }}
              >
                <AddIcon size={16} color="var(--dropdown-add)" className="dropdown-item--add-icon" />
                <span className="dropdown-item--add-stack">
                  <span className="dropdown-item--add-title">Add New Account</span>
                  <span className="dropdown-item--add-caption">Multi-account · Google / Yahoo</span>
                </span>
              </button>
              <div className="dropdown-divider" />
              <button
                className="dropdown-item dropdown-item--logout"
                onClick={() => {
                  setShowUserMenu(false)
                  if (window.confirm('Are you sure you want to log out?'))
                    onLogout()
                }}
              >
                <LogoutIcon size={16} color="var(--text)" />
                Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
