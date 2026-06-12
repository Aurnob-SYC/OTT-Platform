import { useCallback, useEffect, useMemo, useState } from 'react'
import './App.css'
import { Header } from './components/Header'
import { PublisherPanel } from './components/PublisherPanel'
import { RecordingsPanel } from './components/RecordingsPanel'
import { SessionPanel } from './components/SessionPanel'
import { StreamsPanel } from './components/StreamsPanel'
import {
  ApiClientError,
  deleteRecording,
  listRecordings,
  listStreams,
  startViewerSession,
  stopViewerSession,
} from './services/backendApi'
import type {
  BackendRecording,
  BackendStreamStatus,
  LiveStream,
  MediaSession,
  PlaybackState,
  ViewerPlaybackMode,
} from './types'

const VIEWER_ID = 'viewer-1'
const STREAM_REFRESH_MS = 5000

function toUserErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    return `${error.code}: ${error.message}`
  }

  if (error instanceof Error) {
    if (error instanceof TypeError && error.message === 'Failed to fetch') {
      return 'Could not reach the backend API. Start the backend on port 4000.'
    }

    return error.message
  }

  return 'Unexpected frontend error.'
}

function mapBackendStreamToLiveStream(stream: BackendStreamStatus): LiveStream {
  const startedAt = Date.parse(
    stream.timestamps.liveAt ||
      stream.timestamps.encodingStartedAt ||
      stream.timestamps.publishingStartedAt ||
      stream.timestamps.createdAt,
  )

  return {
    bitrate: stream.encoder.renditions?.join(', ') || '-',
    creator: stream.publisher.userId || 'unknown',
    encoderPid: stream.encoder.pid ?? undefined,
    hlsOutput: stream.output.hlsOutputDir,
    id: stream.streamId,
    mediaMtxPath: stream.relay.mediaMtxPath,
    playbackUrl: stream.output.playbackUrl,
    resolution: stream.encoder.renditions?.at(-1) || 'pending',
    startedAt: Number.isNaN(startedAt) ? Date.now() : startedAt,
    status: stream.state,
    title: stream.title,
    viewers: 0,
  }
}

function App() {
  const [deletingRecordingId, setDeletingRecordingId] = useState<string>()
  const [isRefreshingStreams, setIsRefreshingStreams] = useState(false)
  const [isRefreshingRecordings, setIsRefreshingRecordings] = useState(false)
  const [session, setSession] = useState<MediaSession | undefined>()
  const [playbackMode, setPlaybackMode] = useState<ViewerPlaybackMode>('normal')
  const [recordingListError, setRecordingListError] = useState<string>()
  const [streamListError, setStreamListError] = useState<string>()
  const [backendStreams, setBackendStreams] = useState<BackendStreamStatus[]>([])
  const [recordings, setRecordings] = useState<BackendRecording[]>([])
  const [streams, setStreams] = useState<LiveStream[]>([])

  const selectedStream = useMemo(
    () =>
      session?.source === 'live'
        ? streams.find((stream) => stream.id === session.streamId)
        : undefined,
    [session, streams],
  )
  const selectedRecording = useMemo(
    () =>
      session?.source === 'recording'
        ? recordings.find((recording) => recording.recordingId === session.recordingId)
        : undefined,
    [recordings, session],
  )
  const hasActiveViewerSession =
    session?.playbackState === 'loading' ||
    session?.playbackState === 'ready' ||
    session?.playbackState === 'playing'

  const liveCount = streams.filter((stream) => stream.status === 'live').length
  const viewerCount =
    streams.reduce((sum, stream) => sum + stream.viewers, 0) + (hasActiveViewerSession ? 1 : 0)

  const refreshStreams = useCallback(async (): Promise<void> => {
    setIsRefreshingStreams(true)

    try {
      const response = await listStreams()
      setBackendStreams(response.streams)
      setStreams(response.streams.map(mapBackendStreamToLiveStream))
      setStreamListError(undefined)
    } catch (error) {
      setStreamListError(toUserErrorMessage(error))
    } finally {
      setIsRefreshingStreams(false)
    }
  }, [])

  const refreshRecordings = useCallback(async (): Promise<void> => {
    setIsRefreshingRecordings(true)

    try {
      const response = await listRecordings()
      setRecordings(response.recordings)
      setRecordingListError(undefined)
    } catch (error) {
      setRecordingListError(toUserErrorMessage(error))
    } finally {
      setIsRefreshingRecordings(false)
    }
  }, [])

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => {
      void refreshStreams()
    }, 0)
    const interval = window.setInterval(() => {
      void refreshStreams()
    }, STREAM_REFRESH_MS)

    return () => {
      window.clearInterval(interval)
      window.clearTimeout(initialRefresh)
    }
  }, [refreshStreams])

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => {
      void refreshRecordings()
    }, 0)
    const interval = window.setInterval(() => {
      void refreshRecordings()
    }, STREAM_REFRESH_MS)

    return () => {
      window.clearInterval(interval)
      window.clearTimeout(initialRefresh)
    }
  }, [refreshRecordings])

  useEffect(() => {
    function clearViewerSession(): void {
      void stopViewerSession(VIEWER_ID, { keepalive: true }).catch(() => undefined)
    }

    window.addEventListener('pagehide', clearViewerSession)

    return () => {
      window.removeEventListener('pagehide', clearViewerSession)
    }
  }, [])

  async function startWatchSession(stream: LiveStream): Promise<void> {
    if (stream.status !== 'live') {
      setSession({
        errorMessage: 'Only live, HLS-ready streams can be played.',
        playback: undefined,
        playbackState: 'stream-unavailable',
        source: 'live',
        streamId: stream.id,
      })
      return
    }

    if (session?.source === 'recording') {
      setSession(undefined)
    }

    setSession({
      playback: undefined,
      playbackState: 'loading',
      source: 'live',
      streamId: stream.id,
    })

    try {
      const response = await startViewerSession(VIEWER_ID, stream.id)

      setSession({
        playback: response.playback,
        playbackState: 'loading',
        source: 'live',
        streamId: response.streamId,
      })
    } catch (error) {
      setSession({
        errorMessage: toUserErrorMessage(error),
        playback: undefined,
        playbackState: 'stream-unavailable',
        source: 'live',
        streamId: stream.id,
      })
    }
  }

  const updatePlaybackState = useCallback(
    (playbackState: PlaybackState, errorMessage?: string): void => {
      setSession((currentSession) =>
        currentSession
          ? {
              ...currentSession,
              errorMessage,
              playbackState,
            }
          : currentSession,
      )
    },
    [],
  )

  async function stopWatchSession(): Promise<void> {
    if (session?.source === 'live') {
      await stopViewerSession(VIEWER_ID).catch(() => undefined)
    }
    setSession(undefined)
  }

  async function startRecordingPlayback(recording: BackendRecording): Promise<void> {
    if (session?.source === 'live') {
      await stopViewerSession(VIEWER_ID).catch(() => undefined)
    }

    setPlaybackMode('normal')
    setSession({
      playback: {
        normal: {
          type: 'hls',
          url: recording.playbackUrl,
        },
        ops: {
          type: 'hls',
          url: recording.playbackUrl,
        },
      },
      playbackState: 'loading',
      recordingId: recording.recordingId,
      source: 'recording',
    })
  }

  async function removeRecording(recording: BackendRecording): Promise<void> {
    if (deletingRecordingId) {
      return
    }

    setDeletingRecordingId(recording.recordingId)
    setRecordingListError(undefined)

    try {
      if (session?.source === 'recording' && session.recordingId === recording.recordingId) {
        setSession(undefined)
      }

      await deleteRecording(recording.recordingId)
      await refreshRecordings()
    } catch (error) {
      setRecordingListError(toUserErrorMessage(error))
    } finally {
      setDeletingRecordingId(undefined)
    }
  }

  function upsertBackendStream(stream: BackendStreamStatus): void {
    const nextStream = mapBackendStreamToLiveStream(stream)

    setBackendStreams((currentStreams) => {
      const existingIndex = currentStreams.findIndex(
        (currentStream) => currentStream.streamId === stream.streamId,
      )

      if (existingIndex === -1) {
        return [stream, ...currentStreams]
      }

      const updatedStreams = [...currentStreams]
      updatedStreams[existingIndex] = stream

      return updatedStreams
    })

    setStreams((currentStreams) => {
      const existingIndex = currentStreams.findIndex((currentStream) => currentStream.id === nextStream.id)

      if (existingIndex === -1) {
        return [nextStream, ...currentStreams]
      }

      const updatedStreams = [...currentStreams]
      updatedStreams[existingIndex] = {
        ...nextStream,
        viewers: currentStreams[existingIndex].viewers,
      }

      return updatedStreams
    })
  }

  return (
    <>
      <Header liveCount={liveCount} totalCount={streams.length} viewerCount={viewerCount} />

      <main className="app-layout">
        <div className="side-stack">
          <PublisherPanel onStreamChanged={upsertBackendStream} streams={backendStreams} />
          <StreamsPanel
            activeStreamId={session?.source === 'live' ? session.streamId : undefined}
            errorMessage={streamListError}
            isRefreshing={isRefreshingStreams}
            onRefresh={() => void refreshStreams()}
            onSelectStream={startWatchSession}
            streams={streams}
          />
          <SessionPanel
            onPlaybackModeChange={setPlaybackMode}
            onPlaybackStateChange={updatePlaybackState}
            onStop={stopWatchSession}
            playbackMode={playbackMode}
            recording={selectedRecording}
            session={session}
            stream={selectedStream}
          />
          <RecordingsPanel
            activeRecordingId={session?.source === 'recording' ? session.recordingId : undefined}
            deletingRecordingId={deletingRecordingId}
            errorMessage={recordingListError}
            isRefreshing={isRefreshingRecordings}
            onDeleteRecording={(recording) => void removeRecording(recording)}
            onPlayRecording={(recording) => void startRecordingPlayback(recording)}
            onRefresh={() => void refreshRecordings()}
            recordings={recordings}
          />
        </div>

        <aside className="operator-strip" aria-label="Chapter 1 runtime boundaries">
          <span>
            Backend orchestrates metadata and encoder workers for <strong>{VIEWER_ID}</strong>.
          </span>
          <span>Media segments stay behind nginx, outside the application server.</span>
        </aside>
      </main>
    </>
  )
}

export default App
