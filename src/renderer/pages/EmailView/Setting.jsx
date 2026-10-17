import { useEffect, useRef, useState } from 'react'
import {
  CloseIcon, ChevronDownIcon, ChevronRightIcon,
  UserIcon, HeadphonesIcon, CheckIcon,
} from '../../components/icons'

const PAUSE_SECONDS_MIN = 0
const PAUSE_SECONDS_MAX = 10
const PAUSE_SECONDS_DEFAULT = 0.7

function normalizePauseSeconds(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return PAUSE_SECONDS_DEFAULT
  return Math.min(PAUSE_SECONDS_MAX, Math.max(PAUSE_SECONDS_MIN, n))
}

// ── ToggleSwitch ──────────────────────────────────────────────────────────────
function ToggleSwitch({ checked, onChange }) {
  return (
    <label className="plan-toggle">
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span className="plan-toggle-track" />
      <span className="plan-toggle-thumb" />
    </label>
  )
}

// ── ThemeChoiceCard ───────────────────────────────────────────────────────────
function ThemeChoiceCard({ value, currentTheme, onSelect }) {
  const selected = currentTheme === value
  return (
    <button
      type="button"
      className={`setting-theme-card${selected ? ' selected' : ''}`}
      onClick={() => onSelect(value)}
    >
      <div className={`setting-theme-preview ${value}`} />
      <div className="setting-theme-card-footer">
        <span className="setting-theme-card-label">
          {value === 'light' ? 'Light' : 'Dark'}
        </span>
        {selected && (
          <span className="setting-theme-check">
            <CheckIcon size={16} />
          </span>
        )}
      </div>
    </button>
  )
}

// ── SettingNavItem ────────────────────────────────────────────────────────────
function SettingNavItem({ icon, label, isActive, onClick }) {
  return (
    <button
      type="button"
      className={`setting-nav-item${isActive ? ' active' : ''}`}
      onClick={onClick}
    >
      <span className="setting-nav-icon">{icon}</span>
      <span className="setting-nav-label">{label}</span>
      <span className="setting-nav-chevron">
        <ChevronRightIcon size={16} />
      </span>
    </button>
  )
}

// ── OptionGroup ───────────────────────────────────────────────────────────────
function OptionGroup({ options, value, onChange }) {
  return (
    <div className="setting-option-group">
      {options.map(opt => (
        <button
          key={opt.value}
          type="button"
          className={`setting-option-btn${value === opt.value ? ' selected' : ''}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

// ── SettingDropdown ───────────────────────────────────────────────────────────
function SettingDropdown({ label, options, value, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const selectedLabel = options.find(o => o.value === value)?.label ?? value

  return (
    <div className="setting-dropdown-wrapper" ref={ref}>
      <span className="setting-label">{label}</span>
      <button
        type="button"
        className={`setting-dropdown-trigger${open ? ' open' : ''}`}
        onClick={() => setOpen(prev => !prev)}
      >
        <span className="setting-dropdown-selected-text">{selectedLabel}</span>
        <span className={`setting-dropdown-chevron${open ? ' open' : ''}`}>
          <ChevronDownIcon size={16} />
        </span>
      </button>
      {open && (
        <ul className="setting-dropdown-menu" role="listbox">
          {options.map(opt => (
            <li
              key={opt.value}
              role="option"
              aria-selected={value === opt.value}
              className={`setting-dropdown-item${value === opt.value ? ' selected' : ''}`}
              onMouseDown={() => {
                onChange(opt.value)
                setOpen(false)
              }}
            >
              <span>{opt.label}</span>
              {value === opt.value && (
                <span className="setting-dropdown-check">
                  <CheckIcon size={16} />
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── GeneralPanel ──────────────────────────────────────────────────────────────
const FONT_SIZE_OPTIONS = [
  { value: 'small',  label: 'Small'  },
  { value: 'medium', label: 'Medium' },
  { value: 'large',  label: 'Large'  },
]
const LANGUAGE_OPTIONS = [
  { value: 'en-US', label: 'English (US)' },
]

const EMAILS_PER_PAGE_OPTIONS = [
  { value: 20,  label: '20'  },
  { value: 50,  label: '50'  },
  { value: 100, label: '100' },
]

function GeneralPanel({ theme, onThemeChange, fontSize, onFontSizeChange, language, onLanguageChange, emailsPerPage, onEmailsPerPageChange }) {
  return (
    <div className="setting-panel">
      <div className="setting-section">
        <h4 className="setting-section-title">Theme</h4>
        <div className="setting-theme-cards">
          <ThemeChoiceCard value="light" currentTheme={theme} onSelect={onThemeChange} />
          <ThemeChoiceCard value="dark"  currentTheme={theme} onSelect={onThemeChange} />
        </div>
      </div>

      <div className="setting-section">
        <h4 className="setting-section-title">Font Size</h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <span className="setting-label">Default font size</span>
          <OptionGroup options={FONT_SIZE_OPTIONS} value={fontSize} onChange={onFontSizeChange} />
        </div>
      </div>

      <div className="setting-section">
        <h4 className="setting-section-title">Language &amp; Region</h4>
        <SettingDropdown
          label="Display Language"
          options={LANGUAGE_OPTIONS}
          value={language}
          onChange={onLanguageChange}
        />
      </div>

      <div className="setting-section">
        <h4 className="setting-section-title">Email List</h4>
        <SettingDropdown
          label="Emails per page"
          options={EMAILS_PER_PAGE_OPTIONS}
          value={emailsPerPage}
          onChange={val => onEmailsPerPageChange(Number(val))}
        />
      </div>
    </div>
  )
}

// ── AudioPanel ────────────────────────────────────────────────────────────────
const SPEED_OPTIONS = [
  { value: 'Slow',   label: 'Slow'   },
  { value: 'Normal', label: 'Normal' },
  { value: 'Fast',   label: 'Fast'   },
]
function AudioPanel({
  ttsSpeed, onSpeedChange,
  ttsVoice, onVoiceChange, speechVoices, selectedVoiceUri,
  pauseEnabled, onPauseEnabledChange,
  pauseSeconds, onPauseSecondsApply,
}) {
  const voices = Array.isArray(speechVoices) ? speechVoices : []
  const voiceOptions = [
    { value: 'Female', label: 'Auto (Female)' },
    { value: 'Male',   label: 'Auto (Male)'   },
    ...voices.map(v => ({ value: v.voiceURI, label: v.name })),
  ]
  const voiceValue = selectedVoiceUri || ttsVoice
  const [pauseInput, setPauseInput] = useState(String(normalizePauseSeconds(pauseSeconds)))

  useEffect(() => {
    setPauseInput(String(normalizePauseSeconds(pauseSeconds)))
  }, [pauseSeconds])

  const commitPauseInput = (raw) => {
    const normalized = normalizePauseSeconds(raw)
    setPauseInput(String(normalized))
    onPauseSecondsApply(normalized)
  }

  return (
    <div className="setting-panel">
      <div className="setting-section">
        <h4 className="setting-section-title">Reading Speed</h4>
        <OptionGroup options={SPEED_OPTIONS} value={ttsSpeed} onChange={onSpeedChange} />
      </div>

      <div className="setting-section">
        <h4 className="setting-section-title">Voice</h4>
        <SettingDropdown
          label="TTS Voice"
          options={voiceOptions}
          value={voiceValue}
          onChange={onVoiceChange}
        />
      </div>

      <div className="setting-section">
        <h4 className="setting-section-title">Sentence Pause</h4>
        <div className="setting-pause-row">
          <span className="setting-pause-toggle-label">
            Enable pause
            <ToggleSwitch
              checked={!!pauseEnabled}
              onChange={e => onPauseEnabledChange(e.target.checked)}
            />
          </span>
          <span className="setting-pause-sublabel">Pause Time</span>
          <input
            type="number"
            className="setting-pause-input"
            min={PAUSE_SECONDS_MIN}
            max={PAUSE_SECONDS_MAX}
            step="0.1"
            value={pauseInput}
            disabled={!pauseEnabled}
            onChange={e => {
              const raw = e.target.value
              setPauseInput(raw)
              if (raw === '') return
              const parsed = Number(raw)
              if (Number.isFinite(parsed)) {
                onPauseSecondsApply(normalizePauseSeconds(parsed))
              }
            }}
            onBlur={() => commitPauseInput(pauseInput)}
          />
          <span className="setting-pause-unit">S</span>
        </div>
      </div>
    </div>
  )
}

// ── Setting ───────────────────────────────────────────────────────────────────
export function Setting({
  theme, onThemeChange,
  fontSize, onFontSizeChange,
  language, onLanguageChange,
  emailsPerPage, onEmailsPerPageChange,
  ttsSpeed, onSpeedChange,
  ttsVoice, onVoiceChange,
  speechVoices, selectedVoiceUri,
  pauseEnabled, onPauseEnabledChange,
  pauseSeconds, onPauseSecondsApply,
  onClose,
}) {
  const [activeTab, setActiveTab] = useState('general')

  const tabTitle = activeTab === 'general' ? 'General' : 'Audio & TTS'

  return (
    <div className="modal-overlay">
      <div className="setting-modal">
        {/* ── Sidebar ── */}
        <aside className="setting-sidebar">
          <div className="setting-sidebar-header">
            <h2 className="setting-sidebar-title">Settings</h2>
          </div>
          <nav className="setting-nav">
            <SettingNavItem
              icon={<UserIcon size={20} />}
              label="General"
              isActive={activeTab === 'general'}
              onClick={() => setActiveTab('general')}
            />
            <SettingNavItem
              icon={<HeadphonesIcon size={20} />}
              label="Audio & TTS"
              isActive={activeTab === 'audio'}
              onClick={() => setActiveTab('audio')}
            />
          </nav>
        </aside>

        {/* ── Content ── */}
        <div className="setting-content">
          <header className="setting-content-header">
            <h3 className="setting-content-title">{tabTitle}</h3>
            <button
              type="button"
              className="setting-close-btn"
              aria-label="Close settings"
              onClick={onClose}
            >
              <CloseIcon size={20} />
            </button>
          </header>
          <div className="setting-content-body">
            {activeTab === 'general' ? (
              <GeneralPanel
                theme={theme}
                onThemeChange={onThemeChange}
                fontSize={fontSize}
                onFontSizeChange={onFontSizeChange}
                language={language}
                onLanguageChange={onLanguageChange}
                emailsPerPage={emailsPerPage}
                onEmailsPerPageChange={onEmailsPerPageChange}
              />
            ) : (
              <AudioPanel
                ttsSpeed={ttsSpeed}
                onSpeedChange={onSpeedChange}
                ttsVoice={ttsVoice}
                onVoiceChange={onVoiceChange}
                speechVoices={speechVoices}
                selectedVoiceUri={selectedVoiceUri}
                pauseEnabled={pauseEnabled}
                onPauseEnabledChange={onPauseEnabledChange}
                pauseSeconds={pauseSeconds}
                onPauseSecondsApply={onPauseSecondsApply}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
