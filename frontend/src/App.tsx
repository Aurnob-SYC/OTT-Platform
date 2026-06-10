import { useCallback, useEffect, useMemo, useState } from 'react'
import './App.css'
import { Header } from './components/Header'
import { PublisherPanel } from './components/PublisherPanel'
import { SessionPanel } from './components/SessionPanel'
import { StreamsPanel } from './components/StreamsPanel'
import {
  ApiClientError,
  listStreams,
  startViewerSession,
  stopViewerSession,
} from './services/backendApi'
import type { BackendStreamStatus, LiveStream, ViewerPlaybackMode, WatchSession } from './types'

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
  const [isRefreshingStreams, setIsRefreshingStreams] = useState(false)
  const [session, setSession] = useState<WatchSession | undefined>()
  const [playbackMode, setPlaybackMode] = useState<ViewerPlaybackMode>('normal')
  const [streamListError, setStreamListError] = useState<string>()
  const [backendStreams, setBackendStreams] = useState<BackendStreamStatus[]>([])
  const [streams, setStreams] = useState<LiveStream[]>([])

  const selectedStream = useMemo(
    () => streams.find((stream) => stream.id === session?.streamId),
    [session?.streamId, streams],
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
        playbackState: 'stream-unavailable',
        playbackUrl: stream.playbackUrl,
        streamId: stream.id,
      })
      return
    }

    setSession({
      playbackState: 'loading',
      playbackUrl: '',
      streamId: stream.id,
    })

    try {
      const response = await startViewerSession(VIEWER_ID, stream.id)

      setSession({
        playbackState: 'loading',
        playbackUrl: response.playbackUrl,
        streamId: response.streamId,
      })
    } catch (error) {
      setSession({
        errorMessage: toUserErrorMessage(error),
        playbackState: 'stream-unavailable',
        playbackUrl: stream.playbackUrl,
        streamId: stream.id,
      })
    }
  }

  const updatePlaybackState = useCallback(
    (playbackState: WatchSession['playbackState'], errorMessage?: string): void => {
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
    await stopViewerSession(VIEWER_ID).catch(() => undefined)
    setSession(undefined)
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
            activeStreamId={session?.streamId}
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
            session={session}
            stream={selectedStream}
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
