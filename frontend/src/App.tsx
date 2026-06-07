import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { Header } from './components/Header'
import { PipelinePanel } from './components/PipelinePanel'
import { PublisherPanel } from './components/PublisherPanel'
import { SessionPanel } from './components/SessionPanel'
import { StreamsPanel } from './components/StreamsPanel'
import { INITIAL_STREAMS } from './data/streams'
import type { BackendStreamStatus, LiveStream, PipelineStage, WatchSession } from './types'

const VIEWER_ID = 'viewer-1'

function App() {
  const [streams, setStreams] = useState<LiveStream[]>(INITIAL_STREAMS)
  const [session, setSession] = useState<WatchSession | undefined>()

  const selectedStream = useMemo(
    () => streams.find((stream) => stream.id === session?.streamId),
    [session?.streamId, streams],
  )

  const liveCount = streams.filter((stream) => stream.status === 'live').length
  const viewerCount = streams.reduce((sum, stream) => sum + stream.viewers, 0) + (session ? 1 : 0)
  const activeStage: PipelineStage = session ? 'watch' : 'publish'

  useEffect(() => {
    const interval = window.setInterval(() => {
      setStreams((currentStreams) =>
        currentStreams.map((stream) => {
          if (stream.status !== 'live') {
            return stream
          }

          const drift = Math.floor(Math.random() * 5) - 2

          return {
            ...stream,
            viewers: Math.max(0, stream.viewers + drift),
          }
        }),
      )
    }, 4000)

    return () => window.clearInterval(interval)
  }, [])

  function startWatchSession(stream: LiveStream): void {
    if (stream.status !== 'live') {
      return
    }

    setSession({
      playbackState: 'ready',
      playbackUrl: `/hls/${stream.id}/master.m3u8`,
      streamId: stream.id,
    })
  }

  function playSelectedStream(): void {
    setSession((currentSession) =>
      currentSession
        ? {
            ...currentSession,
            playbackState: 'playing',
          }
        : currentSession,
    )
  }

  function stopWatchSession(): void {
    setSession(undefined)
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
      resolution: stream.encoder.renditions?.at(-1) || 'pending',
      startedAt: Number.isNaN(startedAt) ? Date.now() : startedAt,
      status: stream.state,
      title: stream.title,
      viewers: 0,
    }
  }

  function upsertBackendStream(stream: BackendStreamStatus): void {
    const nextStream = mapBackendStreamToLiveStream(stream)

    setStreams((currentStreams) => {
      const existingIndex = currentStreams.findIndex(
        (currentStream) => currentStream.id === nextStream.id,
      )

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
        <PipelinePanel activeStage={activeStage} isPlaying={session?.playbackState === 'playing'} />

        <div className="side-stack">
          <PublisherPanel onStreamChanged={upsertBackendStream} />
          <StreamsPanel
            activeStreamId={session?.streamId}
            onSelectStream={startWatchSession}
            streams={streams}
          />
          <SessionPanel
            onPlay={playSelectedStream}
            onStop={stopWatchSession}
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
