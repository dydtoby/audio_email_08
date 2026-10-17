import { ChevronDownIcon } from '../../components/icons'

export function MailPagination({
  emailCount,
  currentPage,
  totalPages,
  goToPage,
  disabled = false,
  inputError = false,
  onPreviousPage,
  onNextPage,
  onGoToPageChange,
  onGoToPageSubmit,
}) {
  return (
    <div className="mail-pagination" aria-label="Mail list pagination">
      <div className="mail-pagination__summary">
        <span>{emailCount} email{emailCount === 1 ? '' : 's'}</span>
        <span>Page {currentPage} of {totalPages}</span>
      </div>
      <div className="mail-pagination__controls">
        <button
          type="button"
          className="mail-pagination__nav-btn"
          aria-label="Previous page"
          onClick={onPreviousPage}
          disabled={disabled || currentPage <= 1}
        >
          <span style={{ display: 'inline-flex', transform: 'rotate(90deg)' }}>
            <ChevronDownIcon size={16} />
          </span>
        </button>
        <button
          type="button"
          className="mail-pagination__page-btn"
          aria-current="page"
        >
          {currentPage}
        </button>
        <button
          type="button"
          className="mail-pagination__nav-btn"
          aria-label="Next page"
          onClick={onNextPage}
          disabled={disabled || currentPage >= totalPages}
        >
          <span style={{ display: 'inline-flex', transform: 'rotate(-90deg)' }}>
            <ChevronDownIcon size={16} />
          </span>
        </button>
        <div className="mail-pagination__goto">
          <span className="mail-pagination__goto-label">Go To</span>
          <div className="mail-pagination__goto-group">
            <input
              type="text"
              inputMode="numeric"
              className={`mail-pagination__input${inputError ? ' error' : ''}`}
              aria-label="Page number"
              value={goToPage}
              onChange={event => onGoToPageChange(event.target.value)}
              placeholder="#"
              disabled={disabled}
            />
            <button type="button" className="mail-pagination__go-btn" onClick={onGoToPageSubmit} disabled={disabled}>GO</button>
          </div>
        </div>
      </div>
    </div>
  )
}
