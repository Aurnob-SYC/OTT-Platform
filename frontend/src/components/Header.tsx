interface HeaderProps {
  liveCount: number
  totalCount: number
  viewerCount: number
}

export function Header({ liveCount, totalCount, viewerCount }: HeaderProps) {
  return (
    <header className="app-header">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">
          <span />
        </div>
        <div>
          <p className="product-kicker">Chapter 1 LAN live streaming</p>
          <h1>
            Stream<span>Flow</span>
          </h1>
        </div>
      </div>

      <dl className="stream-metrics" aria-label="Stream summary">
        <div>
          <dt>
            <span className="live-dot" aria-hidden="true" />
            Live
          </dt>
          <dd>{liveCount}</dd>
        </div>
        <div>
          <dt>Total streams</dt>
          <dd>{totalCount}</dd>
        </div>
        <div>
          <dt>Active viewers</dt>
          <dd>{viewerCount}</dd>
        </div>
      </dl>
    </header>
  )
}
