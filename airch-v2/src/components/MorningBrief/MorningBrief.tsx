type Props = {
  message: string
}

export function MorningBrief({ message }: Props) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="rounded-2xl border border-accent/20 bg-card p-5">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-accent">
          Доброе утро
        </p>
        <p className="text-[15px] leading-relaxed text-text whitespace-pre-wrap">
          {message}
        </p>
      </div>
    </div>
  )
}
