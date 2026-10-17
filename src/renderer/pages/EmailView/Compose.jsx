import {
  CloseIcon, MinimizeIcon, MaximizeIcon,
  SendIcon, TrashIcon, AttachmentIcon, ImageIcon,
} from '../../components/icons'

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function Compose({
  isOpen,
  isMinimised,
  composeForm,
  composeSending,
  composeSendError,
  senderEmail,
  composeBodyRef,
  composeAttachmentInputRef,
  composeImageInputRef,
  onToggleMinimised,
  onClose,
  onUpdateField,
  onSend,
  onAttachmentClick,
  onAttachmentSelected,
  onImageClick,
  onImageSelected,
  onDiscard,
  editingDraftId,
  attachments = [],
  onRemoveAttachment,
}) {
  if (!isOpen) return null

  const toAddresses = composeForm.to.split(',').map(s => s.trim()).filter(Boolean)
  const canSend =
    toAddresses.length > 0 &&
    toAddresses.every(addr => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) &&
    composeForm.subject.trim() &&
    composeForm.body.trim()

  return (
    <div className={`compose-window${isMinimised ? ' minimised' : ''}`}>
      <div className="compose-window-header">
        <h2 className="compose-window-title">
          {editingDraftId ? 'Edit Draft' : 'New Message'}
        </h2>
        <div className="compose-window-actions">
          <button
            type="button"
            className="compose-window-action"
            aria-label={isMinimised ? 'Expand compose window' : 'Minimise compose window'}
            onClick={onToggleMinimised}
          >
            {isMinimised ? <MaximizeIcon size={14} /> : <MinimizeIcon size={14} />}
          </button>
          <button
            type="button"
            className="compose-window-action"
            aria-label="Close compose window"
            onClick={onClose}
          >
            <CloseIcon size={14} />
          </button>
        </div>
      </div>

      {!isMinimised && (
        <>
          <div className="compose-fields">
            <div className="compose-field compose-field--readonly">
              <span className="compose-field-label">From</span>
              <span className="compose-field-value">{senderEmail}</span>
            </div>
            <label className="compose-field">
              <span className="compose-field-label">To</span>
              <input
                type="text"
                value={composeForm.to}
                onChange={e => onUpdateField('to', e.target.value)}
                placeholder="Recipients"
              />
            </label>
            <label className="compose-field">
              <span className="compose-field-label">Subject</span>
              <input
                type="text"
                value={composeForm.subject}
                onChange={e => onUpdateField('subject', e.target.value)}
                placeholder="Email subject"
              />
            </label>
          </div>

          <div className="compose-body-wrap">
            <textarea
              ref={composeBodyRef}
              className="compose-body"
              value={composeForm.body}
              onChange={e => onUpdateField('body', e.target.value)}
              placeholder="Write your message..."
            />
          </div>

          {attachments.length > 0 && (
            <div className="compose-attachments">
              <p className="compose-attachments-heading">
                Attachments ({attachments.length})
              </p>
              <div className="compose-attachments-list">
                {attachments.map((file, i) => (
                  <div key={i} className="compose-attachment-chip">
                    <div className="compose-attachment-left">
                      <AttachmentIcon size={16} />
                      <span className="compose-attachment-name">{file.name}</span>
                    </div>
                    <div className="compose-attachment-right">
                      <span className="compose-attachment-size">
                        {formatFileSize(file.size)}
                      </span>
                      <button
                        type="button"
                        className="compose-attachment-delete"
                        aria-label={`Remove ${file.name}`}
                        onClick={() => onRemoveAttachment(i)}
                      >
                        <CloseIcon size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {composeSendError && (
            <div className="compose-send-error" role="alert">
              {composeSendError}
            </div>
          )}

          <div className="compose-footer">
            <div className="compose-footer-tools">
              <input
                ref={composeAttachmentInputRef}
                type="file"
                className="compose-file-input"
                onChange={onAttachmentSelected}
                tabIndex={-1}
              />
              <button
                type="button"
                className="compose-tool-btn"
                aria-label="Attach file"
                onClick={onAttachmentClick}
              >
                <AttachmentIcon size={16} />
              </button>
              <input
                ref={composeImageInputRef}
                type="file"
                accept="image/*"
                className="compose-file-input"
                onChange={onImageSelected}
                tabIndex={-1}
              />
              <button
                type="button"
                className="compose-tool-btn"
                aria-label="Attach image"
                onClick={onImageClick}
              >
                <ImageIcon size={16} />
              </button>
              <button
                type="button"
                className="compose-tool-btn"
                aria-label="Discard draft"
                onClick={onDiscard}
              >
                <TrashIcon size={16} />
              </button>
            </div>
            <button
              type="button"
              className={`compose-send-btn${!canSend ? ' compose-send-btn--locked' : ''}`}
              onClick={onSend}
              disabled={composeSending || !canSend}
            >
              <SendIcon size={14} />
              <span>{composeSending ? 'Sending…' : 'Send'}</span>
            </button>
          </div>
        </>
      )}
    </div>
  )
}
