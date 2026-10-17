import { useState } from 'react'
import { CloseIcon, AddIcon, ClockIcon, TrashIcon } from '../../components/icons'

// ── StatusBadge ──────────────────────────────────────────────────────────────
function StatusBadge({ active }) {
  return (
    <span className={`plan-status-badge ${active ? 'active' : 'negative'}`}>
      {active ? 'Active' : 'Inactive'}
    </span>
  )
}

// ── ToggleSwitch ─────────────────────────────────────────────────────────────
function ToggleSwitch({ checked, onChange }) {
  return (
    <label className="plan-toggle" onClick={e => e.stopPropagation()}>
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span className="plan-toggle-track" />
      <span className="plan-toggle-thumb" />
    </label>
  )
}

// ── WeekDayPills ─────────────────────────────────────────────────────────────
const ALL_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_LABELS = { Sun: 'S', Mon: 'M', Tue: 'T', Wed: 'W', Thu: 'T', Fri: 'F', Sat: 'S' }

function WeekDayPills({ days }) {
  const safeDays = Array.isArray(days) ? days : []
  return (
    <div className="plan-day-pills">
      {ALL_DAYS.filter(d => safeDays.includes(d)).map(d => (
        <span key={d} className="plan-day-pill">{DAY_LABELS[d]}</span>
      ))}
    </div>
  )
}

// ── PlanCard ─────────────────────────────────────────────────────────────────
function PlanCard({ task, onToggle, onEdit, onDelete }) {
  return (
    <div className="plan-card" onClick={onEdit} style={{ cursor: 'pointer' }}>
      <div className="plan-card-top">
        <div className="plan-card-info">
          <div className="plan-card-name-row">
            <span className="plan-card-name">{task.name || 'Scheduled Reading'}</span>
            <StatusBadge active={task.active} />
          </div>
          <div className="plan-card-meta">
            <div className="plan-card-time">
              <ClockIcon size={16} />
              <span>{task.time || `${String(task.hour ?? 9).padStart(2, '0')}:${String(task.minute ?? 0).padStart(2, '0')}`}</span>
            </div>
            <WeekDayPills days={task.days} />
          </div>
          <div className="plan-card-mode">Reading: {task.mode}</div>
        </div>
        <ToggleSwitch
          checked={task.active}
          onChange={e => {
            e.stopPropagation()
            onToggle()
          }}
        />
      </div>
      <div className="plan-card-actions">
        <button
          type="button"
          className="plan-edit-btn"
          onClick={e => {
            e.stopPropagation()
            onEdit()
          }}
        >
          Edit
        </button>
        <button
          type="button"
          className="plan-delete-btn"
          onClick={e => {
            e.stopPropagation()
            onDelete()
          }}
        >
          <TrashIcon size={18} />
        </button>
      </div>
    </div>
  )
}

// ── ScheduleForm ─────────────────────────────────────────────────────────────
const MODES = ['All Emails', 'Unread Only', 'Starred Only']

function ScheduleForm({ initialData, submitLabel, onSubmit, onCancel }) {
  const [name, setName] = useState(initialData?.name || 'Scheduled Reading')
  const [time, setTime] = useState(initialData?.time ?? '09:00')
  const initDays = (initialData?.days && initialData.days.length > 0) ? initialData.days : ALL_DAYS
  const [days, setDays] = useState(initDays)
  const [mode, setMode] = useState(initialData?.mode ?? 'Unread Only')

  const hasChanged = !initialData ||
    name.trim() !== (initialData.name || 'Scheduled Reading') ||
    time !== (initialData.time ?? '09:00') ||
    mode !== (initialData.mode ?? 'Unread Only') ||
    days.length !== initDays.length ||
    !days.every(d => initDays.includes(d));

  const isValid = name.trim() && time && days.length > 0 && mode && hasChanged

  function toggleDay(day) {
    setDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day])
  }

  return (
    <div className="schedule-form">
      {/* Schedule Name */}
      <div className="schedule-form-field">
        <label className="schedule-form-label">Schedule Name</label>
        <input
          type="text"
          className="schedule-form-input"
          placeholder="e.g., Morning Briefing"
          value={name}
          onChange={e => setName(e.target.value)}
        />
      </div>

      {/* Time */}
      <div className="schedule-form-field">
        <label className="schedule-form-label">Time</label>
        <div className="schedule-time-wrap">
          <input
            type="time"
            className="schedule-form-input schedule-time-input"
            value={time}
            onChange={e => setTime(e.target.value)}
          />
          <span className="schedule-time-icon"><ClockIcon size={16} /></span>
        </div>
      </div>

      {/* Repeat On */}
      <div className="schedule-form-field">
        <label className="schedule-form-label">Repeat On</label>
        <div className="schedule-days">
          {ALL_DAYS.map(day => (
            <button
              type="button"
              key={day}
              className={`schedule-day-btn${days.includes(day) ? ' selected' : ''}`}
              onClick={() => toggleDay(day)}
            >
              {day.slice(0, 3)}
            </button>
          ))}
        </div>
      </div>

      {/* Read Which Emails */}
      <div className="schedule-form-field">
        <label className="schedule-form-label">Read Which Emails</label>
        <div className="schedule-mode-grid">
          {MODES.map(m => (
            <button
              type="button"
              key={m}
              className={`schedule-mode-btn${mode === m ? ' selected' : ''}`}
              onClick={() => setMode(m)}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="schedule-form-actions">
        <button type="button" className="schedule-cancel-btn" onClick={onCancel}>Cancel</button>
        <button
          type="button"
          className="schedule-submit-btn"
          disabled={!isValid}
          onClick={() => onSubmit({ name: name.trim(), time, days, mode, active: initialData?.active ?? true })}
        >
          {submitLabel}
        </button>
      </div>
    </div>
  )
}

// ── ScheduledReading ─────────────────────────────────────────────────────────
export function ScheduledReading({ tasks, setTasks, onClose }) {
  const [editingId, setEditingId] = useState(null)
  const [showCreateForm, setShowCreateForm] = useState(false)

  function syncToBackend(newTasks) {
    if (newTasks.length > 0) {
      window.api.scheduleTask(newTasks)
    } else {
      window.api.clearSchedule()
    }
  }

  function handleToggle(id) {
    setTasks(prev => {
      const next = prev.map(t => t.id === id ? { ...t, active: !t.active } : t)
      syncToBackend(next)
      return next
    })
  }

  function handleDelete(id) {
    setTasks(prev => {
      const next = prev.filter(t => t.id !== id)
      syncToBackend(next)
      return next
    })
  }

  function handleCreate(formData) {
    const newTask = { id: Date.now(), ...formData }
    setTasks(prev => {
      const next = [...prev, newTask]
      syncToBackend(next)
      return next
    })
    setShowCreateForm(false)
  }

  function handleUpdate(id, formData) {
    setTasks(prev => {
      const next = prev.map(t => t.id === id ? { ...t, ...formData } : t)
      syncToBackend(next)
      return next
    })
    setEditingId(null)
  }

  async function handleDone() {
    window.api.clearSchedule()
    if (tasks.length > 0) {
      window.api.scheduleTask(tasks)
    }
    onClose()
  }

  return (
    <div className="scheduled-reading-backdrop">
      <div className="scheduled-reading-modal">

        {/* Header */}
        <div className="scheduled-reading-header">
          <div className="scheduled-reading-title">
            <h2>Scheduled Reading</h2>
            <p>Automatically read your emails at specific times</p>
          </div>
          <button type="button" className="scheduled-reading-close" onClick={onClose}>
            <CloseIcon size={20} />
          </button>
        </div>

        {/* Body：固定顶部 + 可滚动卡片区 */}
        <div className="scheduled-reading-body">

          {/* 固定区：无表单时显示按钮，有表单时显示 ScheduleForm */}
          <div className="scheduled-reading-fixed">
            {showCreateForm
              ? <ScheduleForm
                  initialData={null}
                  submitLabel="Create Schedule"
                  onSubmit={handleCreate}
                  onCancel={() => setShowCreateForm(false)}
                />
              : <button
                  type="button"
                  className="add-schedule-btn"
                  onClick={() => { setShowCreateForm(true); setEditingId(null) }}
                >
                  <AddIcon size={20} />
                  Add New Schedule
                </button>
            }
          </div>

          {/* 滚动区：计划卡片列表 */}
          <div className="scheduled-reading-scroll">
            <div className="plan-card-list">
              {tasks.map(task =>
                editingId === task.id
                  ? <ScheduleForm
                      key={task.id}
                      initialData={task}
                      submitLabel="Update Schedule"
                      onSubmit={data => handleUpdate(task.id, data)}
                      onCancel={() => setEditingId(null)}
                    />
                  : <PlanCard key={task.id} task={task}
                      onToggle={() => handleToggle(task.id)}
                      onEdit={() => { setEditingId(task.id); setShowCreateForm(false) }}
                      onDelete={() => handleDelete(task.id)} />
              )}
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="scheduled-reading-footer">
          <button type="button" className="scheduled-done-btn" onClick={handleDone}>
            Done
          </button>
        </div>

      </div>
    </div>
  )
}