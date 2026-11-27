import { useCallback, useEffect, useRef, useState } from 'react'

// Voice for the advisor chat, in two halves:
// - useVoiceRecorder records the owner from the microphone. The server turns it into text.
// - useSpeech reads the advisor's replies aloud with the phone's own voices. Nothing leaves the phone.

// ---------- Recording ----------

// The browser stops by itself after a minute, so a recording that was left on stays small.
const MAX_RECORDING_MS = 60_000
// A tap that was too quick to hold any words.
const MIN_RECORDING_MS = 600
// Formats the server accepts, best first. Chrome and Android make webm, Safari and iPhone make mp4.
const RECORDING_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']

export type VoiceProblem = 'denied' | 'noMicrophone' | 'tooShort' | 'failed'

/** True when this browser can record from the microphone. Needs HTTPS or localhost. */
export function canRecord() {
  return typeof window !== 'undefined' && typeof window.MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia)
}

function recordingType() {
  return RECORDING_TYPES.find((type) => MediaRecorder.isTypeSupported?.(type)) ?? ''
}

type RecorderCallbacks = {
  onRecorded: (audio: Blob) => void
  onProblem: (problem: VoiceProblem) => void
}

/** Tap to start, tap again to stop. The finished recording goes to onRecorded. */
export function useVoiceRecorder(callbacks: RecorderCallbacks) {
  const [isRecording, setIsRecording] = useState(false)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const startingRef = useRef(false)
  const discardRef = useRef(false)
  const timerRef = useRef<number | undefined>(undefined)
  // The latest callbacks, so a recording that ends later reports to the current page state.
  const callbacksRef = useRef(callbacks)
  useEffect(() => {
    callbacksRef.current = callbacks
  })

  const stop = useCallback(() => {
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') recorder.stop()
  }, [])

  // Leaving the page stops the microphone and throws the recording away.
  useEffect(
    () => () => {
      discardRef.current = true
      stop()
    },
    [stop],
  )

  const start = useCallback(async () => {
    if (recorderRef.current || startingRef.current) return
    startingRef.current = true
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (error) {
      startingRef.current = false
      const denied = error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')
      callbacksRef.current.onProblem(denied ? 'denied' : 'noMicrophone')
      return
    }

    const type = recordingType()
    let recorder: MediaRecorder
    try {
      recorder = type ? new MediaRecorder(stream, { mimeType: type }) : new MediaRecorder(stream)
    } catch {
      stream.getTracks().forEach((track) => track.stop())
      startingRef.current = false
      callbacksRef.current.onProblem('failed')
      return
    }

    const chunks: Blob[] = []
    const startedAt = Date.now()
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    }
    recorder.onstop = () => {
      // The microphone light goes off as soon as recording ends.
      stream.getTracks().forEach((track) => track.stop())
      window.clearTimeout(timerRef.current)
      recorderRef.current = null
      setIsRecording(false)
      if (discardRef.current) return
      if (Date.now() - startedAt < MIN_RECORDING_MS) {
        callbacksRef.current.onProblem('tooShort')
        return
      }
      const audio = new Blob(chunks, { type: recorder.mimeType || type || 'audio/webm' })
      if (audio.size === 0) {
        callbacksRef.current.onProblem('tooShort')
        return
      }
      callbacksRef.current.onRecorded(audio)
    }
    recorder.onerror = () => {
      discardRef.current = true
      stop()
      callbacksRef.current.onProblem('failed')
    }

    discardRef.current = false
    recorder.start()
    recorderRef.current = recorder
    startingRef.current = false
    setIsRecording(true)
    timerRef.current = window.setTimeout(stop, MAX_RECORDING_MS)
  }, [stop])

  return { isRecording, start, stop }
}

// ---------- Reading aloud ----------

// The advisor names its language in English. These are the phone voices for each one.
// Hinglish is Hindi in English letters, which a Hindi voice reads naturally.
const SPEECH_TAGS: Record<string, string> = {
  English: 'en-IN',
  Hindi: 'hi-IN',
  Hinglish: 'hi-IN',
  Marathi: 'mr-IN',
  Tamil: 'ta-IN',
  Telugu: 'te-IN',
  Kannada: 'kn-IN',
  Gujarati: 'gu-IN',
  Bengali: 'bn-IN',
  Punjabi: 'pa-IN',
  Malayalam: 'ml-IN',
  Odia: 'or-IN',
  Urdu: 'ur-IN',
  Assamese: 'as-IN',
}

/** The voice language for a chat language. Unknown languages are read in English. */
export function speechTag(language: string) {
  return SPEECH_TAGS[language] ?? 'en-IN'
}

type VoiceLike = { lang: string }

/**
 * The best phone voice for a language tag: an exact match such as hi-IN first, then any voice of the
 * same language. Null when the phone has no voice for it, because an English voice reading Tamil
 * letters would be worse than silence.
 */
export function pickVoice<V extends VoiceLike>(voices: V[], tag: string): V | null {
  const clean = (lang: string) => lang.replace('_', '-').toLowerCase()
  const exact = voices.find((voice) => clean(voice.lang) === tag.toLowerCase())
  if (exact) return exact
  const base = tag.split('-')[0].toLowerCase()
  return voices.find((voice) => clean(voice.lang).split('-')[0] === base) ?? null
}

/** True when this browser can read text aloud. */
export function canSpeak() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'
}

export function useSpeech() {
  // Phones load their voices a moment after the page opens, so the list is kept up to date.
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => (canSpeak() ? window.speechSynthesis.getVoices() : []))

  useEffect(() => {
    if (!canSpeak()) return
    const synth = window.speechSynthesis
    const update = () => setVoices(synth.getVoices())
    synth.addEventListener('voiceschanged', update)
    return () => {
      synth.removeEventListener('voiceschanged', update)
      synth.cancel()
    }
  }, [])

  const stop = useCallback(() => {
    if (canSpeak()) window.speechSynthesis.cancel()
  }, [])

  /** Reads text aloud, replacing anything still being read. False when the phone has no voice for it. */
  const speak = useCallback(
    (text: string, language: string) => {
      if (!canSpeak() || !text.trim()) return false
      const tag = speechTag(language)
      const voice = pickVoice(voices, tag)
      // Before the voice list arrives, the browser picks a voice from the language tag alone.
      if (!voice && voices.length > 0) return false
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = voice?.lang ?? tag
      if (voice) utterance.voice = voice
      window.speechSynthesis.cancel()
      window.speechSynthesis.speak(utterance)
      return true
    },
    [voices],
  )

  return { speak, stop }
}
