import type { BiomarkerScore } from '@/app/lib/types'

const BANDS = [
  { label: 'None', sublabel: 'PHQ-9 ≤ 9', bar: 'bg-emerald-500', text: 'text-emerald-700' },
  { label: 'Mild–Moderate', sublabel: 'PHQ-9 10–14', bar: 'bg-amber-500', text: 'text-amber-700' },
  { label: 'Severe', sublabel: 'PHQ-9 15+', bar: 'bg-red-500', text: 'text-red-700' },
]

export default function DepressionCard({ score }: { score: BiomarkerScore }) {
  const band = BANDS[score.class] ?? BANDS[0]

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Depression</p>
          <p className="text-xs text-zinc-400 mt-0.5">PHQ-9 acoustic proxy</p>
        </div>
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500">Kintsugi</span>
      </div>

      <p className={`text-2xl font-bold ${band.text}`}>{band.label}</p>
      <p className="text-sm text-zinc-500 mb-4">{band.sublabel}</p>

      <div className="mb-3 flex gap-1.5">
        {BANDS.map((b, i) => (
          <div
            key={i}
            className={`h-2 flex-1 rounded-full ${i === score.class ? b.bar : 'bg-zinc-100'}`}
          />
        ))}
      </div>

      <p className="text-xs text-zinc-400">
        Raw score:{' '}
        <span className="font-mono">{score.raw_score.toFixed(4)}</span>
      </p>
    </div>
  )
}
