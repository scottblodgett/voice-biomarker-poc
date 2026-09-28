'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import ResultsView from './ResultsView'
import type { AnalyzeResponse } from '@/app/lib/types'

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'
const MIN_SECONDS = 30
const MAX_SECONDS = 180

type Phase = 'idle' | 'recording' | 'recorded' | 'loading' | 'results' | 'error'

function fmt(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export default function VoiceBiomarker() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [loadingElapsed, setLoadingElapsed] = useState(0)
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [results, setResults] = useState<AnalyzeResponse | null>(null)
  const [error, setError] = useState('')
  const [isFileUpload, setIsFileUpload] = useState(false)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const loadTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const stopRecording = useCallback(() => {
    if (recTimerRef.current) { clearInterval(recTimerRef.current); recTimerRef.current = null }
    mediaRecorderRef.current?.stop()
    streamRef.current?.getTracks().forEach(t => t.stop())
  }, [])

  useEffect(() => {
    if (phase !== 'recording') return
    recTimerRef.current = setInterval(() => {
      setElapsed(prev => {
        if (prev + 1 >= MAX_SECONDS) stopRecording()
        return prev + 1
      })
    }, 1000)
    return () => { if (recTimerRef.current) { clearInterval(recTimerRef.current); recTimerRef.current = null } }
  }, [phase, stopRecording])

  useEffect(() => {
    if (phase !== 'loading') return
    loadTimerRef.current = setInterval(() => setLoadingElapsed(p => p + 1), 1000)
    return () => { if (loadTimerRef.current) { clearInterval(loadTimerRef.current); loadTimerRef.current = null } }
  }, [phase])

  useEffect(() => {
    return () => { if (audioUrl) URL.revokeObjectURL(audioUrl) }
  }, [audioUrl])

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      chunksRef.current = []
      setIsFileUpload(false)

      const recorder = new MediaRecorder(stream)
      mediaRecorderRef.current = recorder
      recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        if (audioUrl) URL.revokeObjectURL(audioUrl)
        setAudioBlob(blob)
        setAudioUrl(URL.createObjectURL(blob))
        setPhase('recorded')
      }

      recorder.start()
      setElapsed(0)
      setPhase('recording')
    } catch {
      setError('Microphone access denied. Please allow microphone access and try again.')
      setPhase('error')
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (audioUrl) URL.revokeObjectURL(audioUrl)
    setAudioBlob(file)
    setAudioUrl(URL.createObjectURL(file))
    setIsFileUpload(true)
    setElapsed(MIN_SECONDS)
    setPhase('recorded')
  }

  async function submit() {
    if (!audioBlob) return
    setLoadingElapsed(0)
    setPhase('loading')
    try {
      const body = new FormData()
      body.append('file', audioBlob, 'recording.webm')
      const res = await fetch(`${BACKEND_URL}/analyze`, { method: 'POST', body })
      if (!res.ok) throw new Error(`Server returned ${res.status}`)
      setResults(await res.json())
      setPhase('results')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed. Please try again.')
      setPhase('error')
    }
  }

  function reset() {
    if (audioUrl) URL.revokeObjectURL(audioUrl)
    setAudioBlob(null)
    setAudioUrl(null)
    setResults(null)
    setError('')
    setElapsed(0)
    setIsFileUpload(false)
    setPhase('idle')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  if (phase === 'results' && results) {
    return <ResultsView data={results} onReset={reset} />
  }

  return (
    <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white px-8 py-10 shadow-sm">
      {phase === 'idle' && (
        <div className="flex flex-col items-center gap-6 text-center">
          <div>
            <h1 className="text-xl font-semibold text-zinc-900">Voice Biomarker Analysis</h1>
            <p className="mt-1.5 text-sm text-zinc-500">
              Record 30–180 seconds of natural speech to screen acoustic biomarkers for
              depression and anxiety.
            </p>
          </div>

          <div className="w-full rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-left text-xs text-amber-800">
            <strong>Prototype — not for real patient data.</strong> This demo is not
            HIPAA-compliant. Do not record or upload real patient health information;
            use test/sample audio only.
          </div>

          <button
            onClick={startRecording}
            className="flex h-20 w-20 items-center justify-center rounded-full bg-rose-500 shadow-lg shadow-rose-200 transition-transform hover:scale-105 active:scale-95"
            aria-label="Start recording"
          >
            <MicIcon className="h-8 w-8 text-white" />
          </button>

          <div className="w-full">
            <div className="relative mb-4">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-zinc-100" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-white px-3 text-xs text-zinc-400">or upload a file</span>
              </div>
            </div>
            <label className="cursor-pointer text-sm text-zinc-500 underline underline-offset-4 hover:text-zinc-900 transition-colors">
              Choose audio file
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                className="sr-only"
                onChange={handleFileChange}
              />
            </label>
            <p className="mt-1 text-xs text-zinc-400">File must be at least 30 seconds.</p>
          </div>
        </div>
      )}

      {phase === 'recording' && (
        <div className="flex flex-col items-center gap-6 text-center">
          <p className="font-mono text-4xl font-light tabular-nums text-zinc-900">{fmt(elapsed)}</p>
          <p className={`text-sm ${elapsed >= MAX_SECONDS - 30 ? 'text-amber-600' : elapsed < MIN_SECONDS ? 'text-zinc-400' : 'text-emerald-600'}`}>
            {elapsed < MIN_SECONDS
              ? `${MIN_SECONDS - elapsed}s until minimum`
              : elapsed >= MAX_SECONDS - 30
              ? `${MAX_SECONDS - elapsed}s remaining`
              : 'Recording — minimum reached'}
          </p>

          <div className="relative flex h-20 w-20 items-center justify-center">
            <span className="absolute h-20 w-20 animate-ping rounded-full bg-rose-400 opacity-20" />
            <span className="absolute h-14 w-14 animate-pulse rounded-full bg-rose-300 opacity-40" />
            <div className="relative h-8 w-8 rounded-full bg-rose-500" />
          </div>

          <button
            onClick={stopRecording}
            className="rounded-full border border-zinc-200 px-6 py-2 text-sm font-medium text-zinc-700 hover:border-zinc-400 hover:text-zinc-900 transition-colors"
          >
            Stop recording
          </button>
          <p className="text-xs text-zinc-400">Min 0:30 · Max 3:00</p>
        </div>
      )}

      {phase === 'recorded' && (
        <div className="flex flex-col gap-5">
          <div>
            <p className="mb-2 text-sm font-medium text-zinc-700">
              {isFileUpload ? 'Uploaded file' : `Recording · ${fmt(elapsed)}`}
            </p>
            {audioUrl && <audio controls src={audioUrl} className="w-full" />}
          </div>

          {!isFileUpload && elapsed < MIN_SECONDS && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Only {fmt(elapsed)} recorded — Kintsugi needs at least 30 seconds.
            </p>
          )}

          <div className="flex gap-3">
            <button
              onClick={reset}
              className="flex-1 rounded-xl border border-zinc-200 py-2.5 text-sm font-medium text-zinc-600 hover:border-zinc-300 hover:text-zinc-900 transition-colors"
            >
              {isFileUpload ? 'Change file' : 'Re-record'}
            </button>
            <button
              onClick={submit}
              disabled={!isFileUpload && elapsed < MIN_SECONDS}
              className="flex-1 rounded-xl bg-zinc-900 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
            >
              Analyze →
            </button>
          </div>
        </div>
      )}

      {phase === 'loading' && (
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-zinc-200 border-t-zinc-900" />
          <div>
            <p className="font-medium text-zinc-900">Analyzing…</p>
            <p className="mt-1 text-sm text-zinc-500">
              Acoustic model · Transcription · AI interpretation
            </p>
            <p className="mt-4 font-mono text-2xl font-light tabular-nums text-zinc-400">
              {fmt(loadingElapsed)}
            </p>
            <p className="text-xs text-zinc-400">Typically 15–20 seconds</p>
          </div>
        </div>
      )}

      {phase === 'error' && (
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="w-full rounded-xl border border-red-200 bg-red-50 px-4 py-4">
            <p className="font-medium text-red-800">Something went wrong</p>
            <p className="mt-1 text-sm text-red-700">{error}</p>
          </div>
          <button
            onClick={reset}
            className="text-sm text-zinc-500 underline underline-offset-4 hover:text-zinc-900 transition-colors"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  )
}

function MicIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z"
      />
    </svg>
  )
}
