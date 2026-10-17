import React, { createContext, useCallback, useEffect, useRef, useState } from 'react'
import {
  speedToRate,
  computeSentenceStarts,
  findNextSentenceStart,
  normalizePauseSeconds,
  resolveSpeechVoice,
  PAUSE_SECONDS_DEFAULT,
} from '../utils/voiceUtils'

export const VoiceContext = createContext()

export function VoiceProvider({ children }) {
  const [isAudioBarOpen, setIsAudioBarOpen] = useState(false)
  const [isAudioPaused, setIsAudioPaused] = useState(true)
  const [selectedVoice, setSelectedVoice] = useState('Female')
  const [selectedVoiceUri, setSelectedVoiceUri] = useState('')
  const [speechVoices, setSpeechVoices] = useState([])
  const [selectedSpeed, setSelectedSpeed] = useState('Normal')
  const [pauseEnabled, setPauseEnabled] = useState(false)
  const [pauseSeconds, setPauseSeconds] = useState(PAUSE_SECONDS_DEFAULT)
  
  const [playQueue, setPlayQueue] = useState(null) // { emails, index, mode }
  const [currentWordIndex, setCurrentWordIndex] = useState(-1)
  const [readAlongUtteranceStartChar, setReadAlongUtteranceStartChar] = useState(0)
  
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : null
  const readAlongSessionRef = useRef(null) // { utteranceText, wordOffsets, sentenceStarts }
  const readAlongPauseTimerRef = useRef(null)
  const pendingQueuePlayRef = useRef(false)
  
  // Ref for latest state to use in callbacks
  const stateRef = useRef({
    selectedVoice,
    selectedVoiceUri,
    selectedSpeed,
    pauseEnabled,
    pauseSeconds,
    playQueue,
  })

  useEffect(() => {
    stateRef.current = {
      selectedVoice,
      selectedVoiceUri,
      selectedSpeed,
      pauseEnabled,
      pauseSeconds,
      playQueue,
    }
  }, [selectedVoice, selectedVoiceUri, selectedSpeed, pauseEnabled, pauseSeconds, playQueue])

  // Initial load of voices
  useEffect(() => {
    if (!synth) return

    const loadVoices = () => {
      const v = synth.getVoices()
      if (v.length > 0) setSpeechVoices(v)
    }
    loadVoices()
    if (synth.onvoiceschanged !== undefined) {
      synth.onvoiceschanged = loadVoices
    }
  }, [synth])


  const stop = useCallback(() => {
    if (synth) synth.cancel()
    if (readAlongPauseTimerRef.current) {
      clearTimeout(readAlongPauseTimerRef.current)
      readAlongPauseTimerRef.current = null
    }
    setIsAudioPaused(true)
    setPlayQueue(null)
    setCurrentWordIndex(-1)
    setReadAlongUtteranceStartChar(0)
    readAlongSessionRef.current = null
  }, [synth])

  const pause = useCallback(() => {
    if (synth) synth.pause()
    setIsAudioPaused(true)
  }, [synth])

  const resume = useCallback(() => {
    if (synth) synth.resume()
    setIsAudioPaused(false)
  }, [synth])

  const togglePause = useCallback(() => {
    if (isAudioPaused) resume()
    else pause()
  }, [isAudioPaused, resume, pause])

  const startSpeech = useCallback((textSlice, findWordIndexForChar, onEndCallback) => {
    console.log('[VoiceContext] startSpeech called with text length:', textSlice?.length)
    if (!synth || !textSlice) {
      console.log('[VoiceContext] startSpeech aborted (no synth or text)')
      if (onEndCallback) onEndCallback()
      return
    }

    if (synth.speaking) {
      console.log('[VoiceContext] cancelling previous speech')
      synth.cancel()
    }

    if (readAlongPauseTimerRef.current) {
      clearTimeout(readAlongPauseTimerRef.current)
      readAlongPauseTimerRef.current = null
    }

    const { selectedVoice, selectedVoiceUri, selectedSpeed } = stateRef.current
    const u = new SpeechSynthesisUtterance(textSlice)
    window.__ttsUtterance = u // Prevent Chromium GC bug
    u.lang = navigator.language || 'en-US'
    const voice = resolveSpeechVoice(selectedVoiceUri, selectedVoice)
    if (voice) u.voice = voice
    u.rate = speedToRate(selectedSpeed)

    u.onstart = () => console.log('[VoiceContext] Speech started')
    u.onboundary = e => {
      if (typeof e.charIndex !== 'number' || !readAlongSessionRef.current) return
      const globalChar = (readAlongUtteranceStartChar || 0) + e.charIndex
      const idx = findWordIndexForChar(globalChar, readAlongSessionRef.current.wordOffsets)
      if (idx >= 0) setCurrentWordIndex(idx)
    }

    u.onend = () => {
      console.log('[VoiceContext] Speech ended natively')
      if (onEndCallback) onEndCallback()
    }

    u.onerror = (event) => {
      console.warn('[VoiceContext] SpeechSynthesisUtterance error:', event.error)
      setIsAudioPaused(true)
      if (onEndCallback) onEndCallback()
    }

    console.log('[VoiceContext] synth.speak() triggered')
    synth.speak(u)
    if (synth.paused) {
      console.log('[VoiceContext] synth is paused, attempting resume')
      synth.resume()
    }
    setIsAudioPaused(false)
  }, [synth, readAlongUtteranceStartChar])

  const selectVoiceOption = useCallback((payload) => {
    if (payload.type === 'auto') {
      setSelectedVoice(payload.gender)
      setSelectedVoiceUri('')
    } else {
      setSelectedVoiceUri(payload.voiceURI)
      const hit = synth?.getVoices().find(v => v.voiceURI === payload.voiceURI)
      if (hit) setSelectedVoice(hit.name)
    }
  }, [synth])

  const selectSpeedOption = useCallback((speed) => {
    setSelectedSpeed(speed)
  }, [])

  const voiceChipLabel = selectedVoiceUri
    ? (speechVoices.find(v => v.voiceURI === selectedVoiceUri)?.name || 'System Voice')
    : (selectedVoice || 'Female')

  const value = React.useMemo(() => ({
    isAudioBarOpen,
    setIsAudioBarOpen,
    isAudioPaused,
    setIsAudioPaused,
    selectedVoice,
    setSelectedVoice,
    selectedVoiceUri,
    setSelectedVoiceUri,
    speechVoices,
    voiceChipLabel,
    selectedSpeed,
    setSelectedSpeed,
    pauseEnabled,
    setPauseEnabled,
    pauseSeconds,
    setPauseSeconds,
    playQueue,
    setPlayQueue,
    currentWordIndex,
    setCurrentWordIndex,
    readAlongUtteranceStartChar,
    setReadAlongUtteranceStartChar,
    readAlongSessionRef,
    readAlongPauseTimerRef,
    pendingQueuePlayRef,
    stop,
    pause,
    resume,
    togglePause,
    startSpeech,
    selectVoiceOption,
    selectSpeedOption,
  }), [
    isAudioBarOpen,
    isAudioPaused,
    selectedVoice,
    selectedVoiceUri,
    speechVoices,
    voiceChipLabel,
    selectedSpeed,
    pauseEnabled,
    pauseSeconds,
    playQueue,
    currentWordIndex,
    readAlongUtteranceStartChar,
    stop,
    pause,
    resume,
    togglePause,
    startSpeech,
    selectVoiceOption,
    selectSpeedOption,
  ])

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>
}
