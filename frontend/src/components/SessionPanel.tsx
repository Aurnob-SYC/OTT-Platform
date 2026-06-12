import { useEffect, useRef } from 'react'
import { attachHlsStream, type HlsPlayerHandle } from '../services/hlsPlayer'
import { attachWhepStream, type WhepPlayerHandle } from '../services/whepPlayer'
import type {
  BackendRecording,
  LiveStream,
  MediaSession,
  PlaybackState,
  ViewerPlaybackMode,
} from '../types'
import { EmptyState } from './StreamsPanel'
import { Panel } from './Panel'

interface SessionPanelProps {
  onPlaybackModeChange: (mode: ViewerPlaybackMode) => void
  onPlaybackStateChange: (state: PlaybackState, errorMessage?: string) => void
  onStop: () => void
  playbackMode: ViewerPlaybackMode
  recording?: BackendRecording
  session?: MediaSession
  stream?: LiveStream
}

export function SessionPanel({
  onPlaybackModeChange,
  onPlaybackStateChange,
  onStop,
  playbackMode,
  recording,
  session,
  stream,
}: SessionPanelProps) {
  const playerRef = useRef<HlsPlayerHandle | WhepPlayerHandle | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const isRecordingSession = session?.source === 'recording'
  const activePlayback = session?.playback?.[isRecordingSession ? 'normal' : playbackMode] ?? null
  const activePlaybackUrl = activePlayback?.url ?? null
  const activePlaybackType = activePlayback?.type ?? null
  const selectedMediaId =
    session?.source === 'recording'
      ? recording?.recordingId ?? null
      : session?.source === 'live'
        ? stream?.id ?? null
        : null

  useEffect(() => {
    playerRef.current?.stop()
    playerRef.current = null

    if (!selectedMediaId || !activePlaybackType || !activePlaybackUrl || !videoRef.current) {
      return undefined
    }

    onPlaybackStateChange('loading')

    const player =
      activePlaybackType === 'webrtc'
        ? attachWhepStream({
            onAutoplayBlocked: (message) => onPlaybackStateChange('ready', message),
            onError: (message) => onPlaybackStateChange('playback-error', message),
            onPlaying: () => onPlaybackStateChange('playing'),
            onReady: () => onPlaybackStateChange('ready'),
            sourceUrl: activePlaybackUrl,
            video: videoRef.current,
          })
        : attachHlsStream({
            onAutoplayBlocked: (message) => onPlaybackStateChange('ready', message),
            onError: (message) => onPlaybackStateChange('playback-error', message),
            onPlaying: () => onPlaybackStateChange('playing'),
            onReady: () => onPlaybackStateChange('ready'),
            sourceUrl: activePlaybackUrl,
            video: videoRef.current,
          })

    playerRef.current = player

    return () => {
      player.stop()
      if (playerRef.current === player) {
        playerRef.current = null
      }
    }
  }, [activePlaybackType, activePlaybackUrl, onPlaybackStateChange, playbackMode, selectedMediaId])

  function handlePlay(): void {
    void playerRef.current?.play()
  }

  return (
    <Panel badge={session ? session.playbackState : 'inactive'} title="My Watch Session">
      {!session || (!stream && !recording) ? (
        <EmptyState title="Not watching" message="Select a live stream or recorded video to start playback." />
      ) : (
        <div className="viewer-session">
          {session.source === 'live' ? (
            <div className="mode-toggle" role="group" aria-label="Viewer playback mode">
              <span className="mode-toggle-label">Playback mode</span>
              <div className="mode-toggle-buttons">
                <button
                  aria-pressed={playbackMode === 'normal'}
                  className={`mode-toggle-button ${playbackMode === 'normal' ? 'active' : ''}`}
                  onClick={() => onPlaybackModeChange('normal')}
                  type="button"
                >
                  Normal
                </button>
                <button
                  aria-pressed={playbackMode === 'ops'}
                  className={`mode-toggle-button ${playbackMode === 'ops' ? 'active' : ''}`}
                  onClick={() => onPlaybackModeChange('ops')}
                  type="button"
                >
                  Ops
                </button>
              </div>
            </div>
          ) : null}

          <div className="viewer-player-shell">
            <video
              aria-label={`Viewer playback for ${stream?.title || recording?.title || 'selected media'}`}
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
            {stream ? (
              <>
                <InfoRow label="Stream" value={stream.title} />
                <InfoRow label="Creator" value={`@${stream.creator}`} />
                <InfoRow label="Stream ID" value={stream.id} mono />
                <InfoRow label="MediaMTX path" value={stream.mediaMtxPath} mono />
                <InfoRow label="HLS output" value={stream.hlsOutput} mono />
                <InfoRow label="Mode" value={playbackMode === 'normal' ? 'Normal' : 'Ops'} accent />
              </>
            ) : null}
            {recording ? (
              <>
                <InfoRow label="Recording" value={recording.title} />
                <InfoRow label="Recording ID" value={recording.recordingId} mono />
                <InfoRow label="Source stream" value={recording.sourceStreamId} mono />
                <InfoRow label="VOD output" value={recording.vodOutputPath} mono />
                <InfoRow label="Mode" value="Recorded HLS" accent />
              </>
            ) : null}
            <InfoRow
              label="Playback URL"
              value={activePlayback?.url || stream?.playbackUrl || recording?.playbackUrl || ''}
              accent
              mono
            />
            <InfoRow
              label="Session state"
              value={`${session.playbackState} - single active player`}
              positive={session.playbackState === 'playing'}
            />

            {session.errorMessage ? <p className="error-banner">{session.errorMessage}</p> : null}

            <div className="button-group">
              <button className="btn btn-primary" onClick={handlePlay} type="button">
                <span aria-hidden="true">&gt;</span>
                {session.source === 'recording' ? 'Play Recording' : 'Play Stream'}
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
