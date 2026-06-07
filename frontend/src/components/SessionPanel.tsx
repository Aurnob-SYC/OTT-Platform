import { useEffect, useRef } from 'react'
import { attachHlsStream, type HlsPlayerHandle } from '../services/hlsPlayer'
import type { LiveStream, WatchSession } from '../types'
import { EmptyState } from './StreamsPanel'
import { Panel } from './Panel'

interface SessionPanelProps {
  onPlaybackStateChange: (state: WatchSession['playbackState'], errorMessage?: string) => void
  onStop: () => void
  session?: WatchSession
  stream?: LiveStream
}

export function SessionPanel({
  onPlaybackStateChange,
  onStop,
  session,
  stream,
}: SessionPanelProps) {
  const playerRef = useRef<HlsPlayerHandle | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const selectedStreamId = stream?.id

  useEffect(() => {
    playerRef.current?.stop()
    playerRef.current = null

    if (!session?.playbackUrl || !selectedStreamId || !videoRef.current) {
      return undefined
    }

    const player = attachHlsStream({
      onAutoplayBlocked: (message) => onPlaybackStateChange('ready', message),
      onError: (message) => onPlaybackStateChange('playback-error', message),
      onPlaying: () => onPlaybackStateChange('playing'),
      onReady: () => onPlaybackStateChange('ready'),
      sourceUrl: session.playbackUrl,
      video: videoRef.current,
    })

    playerRef.current = player

    return () => {
      player.stop()
      if (playerRef.current === player) {
        playerRef.current = null
      }
    }
  }, [onPlaybackStateChange, selectedStreamId, session?.playbackUrl])

  function handlePlay(): void {
    void playerRef.current?.play()
  }

  return (
    <Panel badge={session ? session.playbackState : 'inactive'} title="My Watch Session">
      {!session || !stream ? (
        <EmptyState title="Not watching" message="Select a live stream to start a viewer session." />
      ) : (
        <div className="viewer-session">
          <div className="viewer-player-shell">
            <video
              aria-label={`Viewer playback for ${stream.title}`}
              className="viewer-player"
              controls
              playsInline
              ref={videoRef}
            />
            {session.playbackState === 'loading' ? (
              <div className="player-overlay">Loading stream</div>
            ) : null}
          </div>

          <div className="session-card">
            <InfoRow label="Stream" value={stream.title} />
            <InfoRow label="Creator" value={`@${stream.creator}`} />
            <InfoRow label="Stream ID" value={stream.id} mono />
            <InfoRow label="MediaMTX path" value={stream.mediaMtxPath} mono />
            <InfoRow label="HLS output" value={stream.hlsOutput} mono />
            <InfoRow label="Playback URL" value={session.playbackUrl || stream.playbackUrl} accent mono />
            <InfoRow
              label="Session state"
              value={`${session.playbackState} - single active stream`}
              positive={session.playbackState === 'playing'}
            />

            {session.errorMessage ? <p className="error-banner">{session.errorMessage}</p> : null}

            <div className="button-group">
              <button className="btn btn-primary" onClick={handlePlay} type="button">
                <span aria-hidden="true">&gt;</span>
                Play Stream
              </button>
              <button className="btn btn-secondary" onClick={onStop} type="button">
                <span aria-hidden="true">x</span>
                Stop
              </button>
            </div>
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
