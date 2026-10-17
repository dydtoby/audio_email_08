/**
 * AudioControlBar is a presentational control surface for email playback.
 * It renders the open/closed audio panel UI and delegates all behavior
 * to props so audio/TTS logic can be integrated without changing layout code.
 */

/**
 * @param {object} props
 * @param {(payload: { type: 'auto', gender: 'Female'|'Male' } | { type: 'voice', voiceURI: string } | string) => void} props.onSelectVoice
 */
export function AudioControlBar({
  isOpen,
  title,
  subtitle,
  progressLabel,
  isPaused,
  onTogglePaused,
  onGoPrevious,
  onGoNext,
  canGoPrevious = false,
  canGoNext = false,
  canTogglePlayback = true,
  selectedSpeed,
  onSelectSpeed,
  // New-style props (TTS2 read-along integration).
  voiceChipLabel,
  speechVoices,
  selectedVoiceUri,
  selectedVoiceGender,
  // Legacy props — kept for backwards compatibility.
  selectedVoice,
  isVoiceMenuOpen,
  voiceMenuRef,
  onToggleVoiceMenu,
  onSelectVoice,
}) {
  const voices = Array.isArray(speechVoices) ? speechVoices : []
  const gender = selectedVoiceGender ?? selectedVoice ?? 'Female'
  const chipLabel = voiceChipLabel ?? (selectedVoice || `Auto (${gender})`)

  const handleSelectAuto = (g) => {
    if (typeof onSelectVoice !== 'function') return
    // Try new-style payload first; fall back to string for legacy callers.
    try {
      onSelectVoice({ type: 'auto', gender: g })
    } catch {
      onSelectVoice(g)
    }
  }

  return (
    <div className={`audio-control-bar${isOpen ? ' open' : ''}`} aria-hidden={!isOpen}>
      <div className="audio-control-bar__header">
        <div className="audio-control-bar__title-wrap">
          <div className="audio-control-bar__badge" aria-hidden="true">♪</div>
          <div>
            <div className="audio-control-bar__title">{title}</div>
            <div className="audio-control-bar__subtitle">{subtitle}</div>
          </div>
        </div>
        {progressLabel ? (
          <div className="audio-control-bar__progress" aria-label={`Queue progress ${progressLabel}`}>
            {progressLabel}
          </div>
        ) : null}
      </div>

      <div className="audio-control-bar__body">
        <div className="audio-control-bar__controls">
          {progressLabel ? (
            <button
              type="button"
              className="audio-pill-button audio-pill-button--secondary"
              aria-label="Previous email"
              disabled={!canGoPrevious}
              onClick={onGoPrevious}
            >
              <span aria-hidden="true">&lt;</span>
            </button>
          ) : null}
          <button
            type="button"
            className="audio-pill-button audio-pill-button--primary"
            aria-label={canTogglePlayback ? (isPaused ? 'Play audio' : 'Pause audio') : 'Select an email to enable audio playback'}
            aria-pressed={isPaused}
            disabled={!canTogglePlayback}
            onClick={onTogglePaused}
          >
            {isPaused ? (
              <span className="audio-play-icon" aria-hidden="true" />
            ) : (
              <span className="audio-pause-icon" aria-hidden="true">
                <span />
                <span />
              </span>
            )}
          </button>
          {progressLabel ? (
            <button
              type="button"
              className="audio-pill-button audio-pill-button--secondary"
              aria-label="Next email"
              disabled={!canGoNext}
              onClick={onGoNext}
            >
              <span aria-hidden="true">&gt;</span>
            </button>
          ) : null}
        </div>

        <div className="audio-speed-group">
          <span className="audio-group-label">Speed</span>
          <div className="audio-chip-set">
            {['Slow', 'Normal', 'Fast'].map(speed => (
              <button
                key={speed}
                type="button"
                className={`audio-chip${selectedSpeed === speed ? ' audio-chip--active' : ''}`}
                aria-pressed={selectedSpeed === speed}
                onClick={() => onSelectSpeed(speed)}
              >
                {speed}
              </button>
            ))}
          </div>
        </div>

        <div className="audio-voice-group" ref={voiceMenuRef}>
          <span className="audio-group-label">Voice</span>
          <button
            type="button"
            className={`audio-select-chip${isVoiceMenuOpen ? ' audio-select-chip--open' : ''}`}
            aria-label="Selected voice"
            aria-expanded={isVoiceMenuOpen}
            aria-haspopup="menu"
            onClick={onToggleVoiceMenu}
          >
            <span className="audio-select-chip__label">{chipLabel}</span>
            <span className="audio-select-chip__caret" aria-hidden="true">⌄</span>
          </button>
          {isVoiceMenuOpen && (
            <div className="audio-voice-menu" role="menu" aria-label="Voice options">
              {['Female', 'Male'].map(g => (
                <button
                  key={g}
                  type="button"
                  className={`audio-voice-menu__item${!selectedVoiceUri && gender === g ? ' active' : ''}`}
                  role="menuitemradio"
                  aria-checked={!selectedVoiceUri && gender === g}
                  onClick={() => handleSelectAuto(g)}
                >
                  Auto ({g})
                </button>
              ))}
              {voices.length > 0 && (
                <div className="audio-voice-menu__divider" role="separator" />
              )}
              {voices.map(v => (
                <button
                  key={v.voiceURI}
                  type="button"
                  className={`audio-voice-menu__item audio-voice-menu__item--system${selectedVoiceUri === v.voiceURI ? ' active' : ''}`}
                  role="menuitemradio"
                  aria-checked={selectedVoiceUri === v.voiceURI}
                  title={`${v.name} (${v.lang})`}
                  onClick={() => onSelectVoice({ type: 'voice', voiceURI: v.voiceURI })}
                >
                  <span className="audio-voice-menu__name">{v.name}</span>
                  <span className="audio-voice-menu__lang">{v.lang}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
