export type StreamStatus =
  | 'created'
  | 'publishing'
  | 'encoding'
  | 'live'
  | 'stopped'
  | 'failed'
  | 'offline'

export type PublisherState =
  | 'idle'
  | 'requesting-permissions'
  | 'connecting'
  | 'live'
  | 'stopped'
  | 'failed'

export type ViewerPlaybackMode = 'normal' | 'ops'

export interface LiveStream {
  bitrate: string
  creator: string
  encoderPid?: number
  hlsOutput: string
  id: string
  mediaMtxPath: string
  playbackUrl: string
  resolution: string
  startedAt: number
  status: StreamStatus
  title: string
  viewers: number
}

export interface WatchSession {
  errorMessage?: string
  playbackState: 'loading' | 'ready' | 'playing' | 'stopped' | 'stream-unavailable' | 'playback-error'
  playbackUrl: string
  streamId: string
}

export type BackendStreamState = 'created' | 'publishing' | 'encoding' | 'live' | 'stopped' | 'failed'

export interface BackendStreamStatus {
  encoder: {
    orchestration?: string
    pid: number | null
    renditions?: string[]
    state: string
  }
  error: {
    code?: string
    message: string
  } | null
  output: {
    hlsOutputDir: string
    playbackUrl: string
  }
  publisher: {
    userId: string | null
  }
  relay: {
    mediaMtxPath: string
    publishUrl: string
    whipUrl: string
  }
  state: BackendStreamState
  streamId: string
  timestamps: {
    createdAt: string
    encodingStartedAt: string | null
    failedAt: string | null
    liveAt: string | null
    publishingStartedAt: string | null
    stoppedAt: string | null
    updatedAt: string
  }
  title: string
}
