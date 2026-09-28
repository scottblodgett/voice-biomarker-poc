import DepressionCard from './DepressionCard'
import AnxietyCard from './AnxietyCard'
import type { AnalyzeResponse, Interpretation } from '@/app/lib/types'

const INTERP_SECTIONS: Array<{ key: keyof Interpretation; label: string }> = [
  { key: 'summary', label: 'Summary' },
  { key: 'depression', label: 'Depression signal' },
  { key: 'anxiety', label: 'Anxiety signal' },
  { key: 'transcript_observations', label: 'Transcript observations' },
  { key: 'agreement', label: 'Where signals agree' },
  { key: 'divergence', label: 'Where they diverge' },
  { key: 'limitations', label: 'Limitations' },
]

export default function ResultsView({
  data,
  onReset,
}: {
  data: AnalyzeResponse
  onReset: () => void
}) {
  return (
    <div className="w-full max-w-3xl space-y-5">
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <strong>Experimental — NOT a medical diagnosis.</strong> These acoustic biomarkers are a
        research-grade screening signal only. Do not use for clinical decisions.
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <DepressionCard score={data.depression} />
        <AnxietyCard score={data.anxiety} />
      </div>

      <p className="text-center text-xs text-zinc-400">
        Analyzed in {data.processing_seconds.toFixed(1)} s &nbsp;·&nbsp; Kintsugi acoustic &nbsp;+&nbsp; Amazon
        Transcribe &nbsp;+&nbsp; Claude via Bedrock
      </p>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-zinc-900">AI Interpretation</h2>
          <span className="text-xs text-zinc-400">Claude via Amazon Bedrock</span>
        </div>
        {INTERP_SECTIONS.map(({ key, label }) => {
          const text = data.interpretation[key]
          if (!text) return null
          return (
            <div key={key}>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                {label}
              </p>
              <p className="text-sm leading-relaxed text-zinc-700">{text}</p>
            </div>
          )
        })}
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="mb-3 font-semibold text-zinc-900">Transcript</h2>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-700">
          {data.transcript}
        </p>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="mb-3 font-semibold text-zinc-900">Kintsugi raw output</h2>
        <div className="grid grid-cols-2 gap-4 font-mono text-sm text-zinc-700">
          <div>
            depression: {data.depression.raw_score.toFixed(4)} (class {data.depression.class})
          </div>
          <div>
            anxiety: {data.anxiety.raw_score.toFixed(4)} (class {data.anxiety.class})
          </div>
        </div>
      </div>

      <div className="pb-8 text-center">
        <button
          onClick={onReset}
          className="text-sm text-zinc-500 underline underline-offset-4 hover:text-zinc-900 transition-colors"
        >
          Record again
        </button>
      </div>
    </div>
  )
}
