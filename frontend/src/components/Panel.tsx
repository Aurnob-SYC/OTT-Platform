import type { ReactNode } from 'react'

interface PanelProps {
  badge?: string
  children: ReactNode
  title: string
}

export function Panel({ badge, children, title }: PanelProps) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>{title}</h2>
        {badge ? <span className="badge">{badge}</span> : null}
      </div>
      <div className="panel-body">{children}</div>
    </section>
  )
}
