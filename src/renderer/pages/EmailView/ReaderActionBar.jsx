/**
 * ReaderActionBar renders the sender summary and per-email action buttons
 * shown above the email body. It is intentionally UI-focused so reply,
 * forward, read-aloud, star, and delete behavior can be supplied by the
 * parent container.
 */
import { HeadphonesIcon, StarFilledIcon, StarOutlineIcon, TrashIcon } from '../../components/icons'
import { formatDate } from '../../utils/emailUtils'

export function ReaderActionBar({
  email,
  senderInitials,
  onReply,
  onForward,
  onReadThisEmail,
  onToggleStar,
  onDelete,
  deleteDisabled = false,
}) {
  if (!email) return null

  // Ensure date is a string (scheduled emails may pass raw Date objects via IPC)
  const displayTime = email.timeAgo || (email.date ? formatDate(email.date) : '')

  return (
    <div className="reader-meta-card">
      <div className="reader-meta-top-row">
        <div className="reader-sender-profile">
          <div className="reader-sender-avatar">{senderInitials}</div>
          <div className="reader-meta" aria-hidden="true">
            <div className="reader-meta-row">
              <span className="reader-meta-value">{email.fromName}</span>
            </div>
            <div className="reader-meta-row">
              <span className="reader-meta-secondary">{email.fromEmail || ''}</span>
            </div>
          </div>
        </div>
        <span className="reader-meta-time">{displayTime}</span>
      </div>

      <div className="reader-meta-actions">
        <div className="reader-meta-actions-left">
          <button
            type="button"
            className="reader-secondary-action-btn"
            onClick={onReply}
            disabled={!email.fromEmail}
          >
            Reply
          </button>
          <button
            type="button"
            className="reader-secondary-action-btn"
            onClick={onForward}
          >
            Forward
          </button>
        </div>

        <div className="reader-meta-actions-right">
          <button type="button" className="reader-read-action-btn" onClick={onReadThisEmail}>
            <HeadphonesIcon size={16} color="currentColor" />
            <span>Read This Email</span>
          </button>
          <button
            type="button"
            className={`reader-icon-action-btn${email.starred ? ' active' : ''}`}
            aria-label={email.starred ? 'Remove star from this email' : 'Star this email'}
            onClick={() => onToggleStar?.(email)}
          >
            {email.starred ? (
              <StarFilledIcon size={16} color="currentColor" />
            ) : (
              <StarOutlineIcon size={16} color="currentColor" />
            )}
          </button>
          <button
            type="button"
            className="reader-icon-action-btn"
            aria-label="Delete this email"
            aria-busy={deleteDisabled || undefined}
            disabled={deleteDisabled}
            onClick={onDelete}
          >
            <TrashIcon size={16} color="currentColor" />
          </button>
        </div>
      </div>
    </div>
  )
}
