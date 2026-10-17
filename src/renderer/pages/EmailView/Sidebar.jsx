/**
 * Sidebar renders inbox navigation, account groupings, and the search/compose
 * entry points for the email view. It focuses on mailbox navigation UI while
 * leaving data ownership and route-level state in the parent EmailView.
 */
import { useState } from 'react'
import {
  ComposeIcon, SearchIcon, InboxIcon, SendIcon,
  DraftsIcon, TrashIcon, SettingsIcon, ChevronDownIcon,
  ClockIcon, MailIcon,
} from '../../components/icons'

// ── CountPill ────────────────────────────────────────────────────────────────
function CountPill({ count }) {
  if (!count) return null
  return <span className="count-pill">{count}</span>
}

// ── FolderNavItem ────────────────────────────────────────────────────────────
// MUST be <button type="button"> — never <a href="#">, which resets the
// HashRouter hash to / and triggers a navigation to the login page.
function FolderNavItem({ icon, label, count, isActive, onClick }) {
  return (
    <button
      type="button"
      className={`folder-item${isActive ? ' active' : ''}`}
      onClick={onClick}
    >
      <span className="folder-left">
        {isActive && <span className="active-bar" />}
        <span className="folder-icon">{icon}</span>
        <span>{label}</span>
      </span>
      <CountPill count={count} />
    </button>
  )
}

// ── AccountGroup ─────────────────────────────────────────────────────────────
// Collapsible group of folders for a single account.
function AccountGroup({ accountEmail, folders, activeFolder, onFolderChange }) {
  const [expanded, setExpanded] = useState(true)

  return (
    <div className="account-group">
      <button
        type="button"
        className="account-header"
        onClick={() => setExpanded(e => !e)}
      >
        <span className={`account-caret${expanded ? '' : ' collapsed'}`}>
          <ChevronDownIcon size={12} />
        </span>
        <MailIcon size={16} color="var(--muted)" />
        <span className="account-email-label">{accountEmail}</span>
      </button>
      {expanded && (
        <nav className="folder-list nested">
          {folders.map(({ icon, label, folder, count }) => (
            <FolderNavItem
              key={label}
              icon={icon}
              label={label}
              count={count}
              isActive={activeFolder.scope === accountEmail && activeFolder.folder === folder}
              onClick={() => onFolderChange({ scope: accountEmail, folder })}
            />
          ))}
        </nav>
      )}
    </div>
  )
}

// ── Sidebar ──────────────────────────────────────────────────────────────────
/**
 * Props:
 *   emails          — full email list (used for unread badge count)
 *   accountEmail    — primary account email string
 *   effectiveProvider — 'google' | 'yahoo' | 'demo'
 *   isDemoProvider  — boolean shorthand
 *   linkedAccounts  — [{ id, email, provider, color }]
 *   activeFolder    — { scope: 'all'|string, folder: 'inbox'|'sent'|... }
 *   onFolderChange  — ({ scope, folder }) => void
 *   search          — current search string
 *   onSearchChange  — (value: string) => void
 *   searchBusy      — optional: Gmail server search in progress
 *   openCompose     — () => void
 */
export function Sidebar({
  emails,
  accountEmail,
  effectiveProvider,
  isDemoProvider,
  linkedAccounts = [],
  activeFolder,
  onFolderChange,
  search,
  onSearchChange,
  searchBusy = false,
  openCompose,
  totalUnread = 0,
  unreadByScope = {},
  onOpenScheduledReading,
  isScheduledReadingOpen = false,
  onOpenSettings,
}) {

  const primaryEmail =
    accountEmail ||
    (effectiveProvider === 'google'
      ? 'Google Account'
      : isDemoProvider
      ? 'Demo Inbox'
      : 'Yahoo Account')

  const defaultFolders = [
    { icon: <InboxIcon size={16} />, label: 'Inbox', folder: 'inbox', count: unreadByScope[accountEmail] ?? 0 },
    { icon: <SendIcon size={16} />, label: 'Sent', folder: 'sent' },
    { icon: <DraftsIcon size={16} />, label: 'Drafts', folder: 'drafts' },
    { icon: <TrashIcon size={16} />, label: 'Trash', folder: 'trash' },
  ]

  return (
    <aside className="sidebar">
      {/* ── Top: Compose + Search ── */}
      <div className="sidebar-top">
        <button type="button" className="compose-btn" onClick={openCompose}>
          <ComposeIcon size={16} color="currentColor" />
          <span>Compose</span>
        </button>
        <div className="search-box">
          <SearchIcon size={16} color="var(--muted)" />
          <input
            type="text"
            placeholder="Search emails..."
            value={search}
            onChange={e => onSearchChange(e.target.value)}
            aria-busy={searchBusy || undefined}
          />
        </div>
      </div>

      {/* ── Scrollable content ── */}
      <div className="sidebar-scroll">
        {/* ── ALL ACCOUNTS ── */}
        <div className="sidebar-section">
          <div className="section-label">ALL ACCOUNTS</div>
          <nav className="folder-list">
            {[
              { icon: <InboxIcon size={16} />, label: 'Inbox', folder: 'inbox', count: totalUnread },
              { icon: <SendIcon size={16} />, label: 'Sent', folder: 'sent' },
              { icon: <DraftsIcon size={16} />, label: 'Drafts', folder: 'drafts' },
              { icon: <TrashIcon size={16} />, label: 'Trash', folder: 'trash' },
              { icon: <ClockIcon size={16} />, label: 'Plan', folder: 'plan' },
            ].map(({ icon, label, folder, count }) => (
              <FolderNavItem
                key={label}
                icon={icon}
                label={label}
                count={count}
                isActive={
                  folder === 'plan'
                    ? isScheduledReadingOpen
                    : activeFolder.scope === 'all' && activeFolder.folder === folder
                }
                onClick={() => {
                  if (folder === 'plan') {
                    onOpenScheduledReading?.()
                  } else {
                    onFolderChange({ scope: 'all', folder })
                  }
                }}
              />
            ))}
          </nav>
        </div>

        {/* ── Primary account group ── */}
        <AccountGroup
          accountEmail={primaryEmail}
          color="var(--accent)"
          folders={defaultFolders}
          activeFolder={activeFolder}
          onFolderChange={onFolderChange}
        />

        {/* ── Linked account groups ── */}
        {linkedAccounts.map(acc => (
          <AccountGroup
            key={acc.id || acc.email}
            accountEmail={acc.email}
            color={acc.color}
            folders={defaultFolders.map(f => ({ ...f, count: f.folder === 'inbox' ? (unreadByScope[acc.email] ?? 0) : undefined }))}
            activeFolder={activeFolder}
            onFolderChange={onFolderChange}
          />
        ))}
      </div>

      {/* ── Footer: Settings ── */}
      <div className="sidebar-footer">
        <button
          type="button"
          className="settings-btn"
          onClick={() => onOpenSettings?.()}
        >
          <SettingsIcon size={16} />
          <span>Settings</span>
        </button>
      </div>
    </aside>
  )
}
