import type { LiveStream, WatchSession } from '../types'
import { EmptyState } from './StreamsPanel'
import { Panel } from './Panel'

interface SessionPanelProps {
  onPlay: () => void
  onStop: () => void
  session?: WatchSession
  stream?: LiveStream
}

export function SessionPanel({ onPlay, onStop, session, stream }: SessionPanelProps) {
  return (
    <Panel badge={session ? session.playbackState : 'inactive'} title="My Watch Session">
      {!session || !stream ? (
        <EmptyState title="Not watching" message="Select a live stream to start a viewer session." />
      ) : (
        <div className="session-card">
          <InfoRow label="Stream" value={stream.title} />
          <InfoRow label="Creator" value={`@${stream.creator}`} />
          <InfoRow label="Stream ID" value={stream.id} mono />
          <InfoRow label="MediaMTX path" value={stream.mediaMtxPath} mono />
          <InfoRow label="HLS output" value={stream.hlsOutput} mono />
          <InfoRow label="Playback URL" value={session.playbackUrl} accent mono />
          <InfoRow
            label="Session state"
            value={`${session.playbackState} - single active stream`}
            positive={session.playbackState === 'playing'}
          />

          <div className="button-group">
            <button className="btn btn-primary" onClick={onPlay} type="button">
              <span aria-hidden="true">&gt;</span>
              Play Stream
            </button>
            <button className="btn btn-secondary" onClick={onStop} type="button">
              <span aria-hidden="true">x</span>
              Stop
            </button>
          </div>
        </div>
      )}
    </Panel>
  )
}

interface InfoRowProps {
  accent?: boolean
  label: string
  mono?: boolean
  positive?: boolean
  value: string
}

function InfoRow({ accent, label, mono, positive, value }: InfoRowProps) {
  return (
    <div className="info-row">
      <span className="label">{label}</span>
      <span className={`value ${mono ? 'mono' : ''} ${accent ? 'accent' : ''} ${positive ? 'positive' : ''}`}>
        {value}
      </span>
    </div>
  )
}
