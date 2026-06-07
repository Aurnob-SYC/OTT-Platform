import type { LiveStream } from '../types'
import { formatTimeAgo } from '../utils/format'
import { Panel } from './Panel'

interface StreamsPanelProps {
  activeStreamId?: string
  errorMessage?: string
  isRefreshing: boolean
  onRefresh: () => void
  onSelectStream: (stream: LiveStream) => void
  streams: LiveStream[]
}

export function StreamsPanel({
  activeStreamId,
  errorMessage,
  isRefreshing,
  onRefresh,
  onSelectStream,
  streams,
}: StreamsPanelProps) {
  const playableCount = streams.filter((stream) => stream.status === 'live').length

  return (
    <Panel badge={`${playableCount} live`} title="Active Streams">
      <div className="stream-panel-tools">
        <span>{isRefreshing ? 'Refreshing stream list' : 'Backend stream list'}</span>
        <button className="btn btn-secondary compact" onClick={onRefresh} type="button">
          <span aria-hidden="true">R</span>
          Refresh
        </button>
      </div>

      {errorMessage ? <p className="error-banner">{errorMessage}</p> : null}

      {streams.length === 0 ? (
        <EmptyState title="No streams yet" message="Publish a stream to see it appear in this list." />
      ) : (
        <div className="stream-grid">
          {streams.map((stream) => (
            <StreamCard
              isActive={stream.id === activeStreamId}
              key={stream.id}
              onSelect={onSelectStream}
              stream={stream}
            />
          ))}
        </div>
      )}
    </Panel>
  )
}

interface StreamCardProps {
  isActive: boolean
  onSelect: (stream: LiveStream) => void
  stream: LiveStream
}

function StreamCard({ isActive, onSelect, stream }: StreamCardProps) {
  const canWatch = stream.status === 'live'
  const statusLabel = stream.status === 'live' ? 'LIVE' : stream.status.toUpperCase()

  return (
    <button
      className={`stream-card ${isActive ? 'active' : ''}`}
      disabled={!canWatch}
      onClick={() => onSelect(stream)}
      type="button"
    >
      <span className="stream-card-top">
        <span>
          <strong className="stream-title">{stream.title}</strong>
          <span className="stream-creator">@{stream.creator}</span>
        </span>
        <span className={`stream-status-tag ${stream.status}`}>{statusLabel}</span>
      </span>

      <span className="stream-paths">
        <span>
          MediaMTX <code>{stream.mediaMtxPath}</code>
        </span>
        <span>
          HLS <code>/hls/{stream.id}/master.m3u8</code>
        </span>
      </span>

      <span className="stream-meta-row">
        <span>
          Viewers <strong>{stream.viewers}</strong>
        </span>
        <span>
          Bitrate <strong>{stream.bitrate}</strong>
        </span>
        <span>
          Output <strong>{stream.resolution}</strong>
        </span>
        <span>
          Age <strong>{formatTimeAgo(stream.startedAt)}</strong>
        </span>
      </span>
    </button>
  )
}

interface EmptyStateProps {
  message: string
  title: string
}

export function EmptyState({ message, title }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div className="empty-icon" aria-hidden="true" />
      <h3>{title}</h3>
      <p>{message}</p>
    </div>
  )
}
