import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { Header } from './components/Header'
import { PipelinePanel } from './components/PipelinePanel'
import { SessionPanel } from './components/SessionPanel'
import { StreamsPanel } from './components/StreamsPanel'
import { INITIAL_STREAMS } from './data/streams'
import type { LiveStream, PipelineStage, WatchSession } from './types'

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

  return (
    <>
      <Header liveCount={liveCount} totalCount={streams.length} viewerCount={viewerCount} />

      <main className="app-layout">
        <PipelinePanel activeStage={activeStage} isPlaying={session?.playbackState === 'playing'} />

        <div className="side-stack">
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
