import type { StatusTone } from '../types'

const LABELS: Record<StatusTone, string> = {
  green: 'Ready',
  amber: 'Needs input or loading',
  red: 'Unavailable or error',
}

export function StatusDot({ tone }: { tone: StatusTone }) {
  return (
    <span
      className={`sonde-status-dot sonde-status-dot--${tone}`}
      title={LABELS[tone]}
      aria-label={LABELS[tone]}
    />
  )
}
