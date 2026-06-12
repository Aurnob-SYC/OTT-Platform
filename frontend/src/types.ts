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
export type PlaybackState =
  | 'loading'
  | 'ready'
  | 'playing'
  | 'stopped'
  | 'stream-unavailable'
  | 'playback-error'

export interface PlaybackSource {
  type: 'hls' | 'webrtc'
  url: string
}

export interface ViewerPlaybackSet {
  normal: PlaybackSource
  ops: PlaybackSource
}

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
  playback?: ViewerPlaybackSet
  playbackState: PlaybackState
  source: 'live'
  streamId: string
}

export interface RecordingWatchSession {
  errorMessage?: string
  playback?: ViewerPlaybackSet
  playbackState: PlaybackState
  recordingId: string
  source: 'recording'
}

export type MediaSession = WatchSession | RecordingWatchSession

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

export type RecordingState =
  | 'recording'
  | 'finalizing'
  | 'packaging'
  | 'packaged'
  | 'failed'
  | 'deleting'
  | 'deleted'

export interface BackendRecording {
  archivePath: string
  createdAt: string
  deletedAt: string | null
  deletingAt: string | null
  durationSeconds: number | null
  error: {
    code?: string
    message: string
  } | null
  failedAt: string | null
  finalizingAt: string | null
  packagedAt: string | null
  packagingStartedAt: string | null
  playbackUrl: string
  recordingId: string
  sourceStreamId: string
  startedAt: string
  state: RecordingState
  title: string
  updatedAt: string
  visible: boolean
  vodOutputPath: string
}
