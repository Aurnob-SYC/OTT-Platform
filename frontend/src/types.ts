export type PipelineStage = 'publish' | 'encode' | 'serve' | 'watch'

export type PipelineStatus = 'done' | 'active' | 'idle'

export type StreamStatus = 'live' | 'encoding' | 'failed' | 'offline'

export interface PipelineStep {
  actor: string
  code?: string
  description: string
  id: number
  prefix?: string
  stage: PipelineStage
  status: PipelineStatus
  suffix?: string
}

export interface LiveStream {
  bitrate: string
  creator: string
  encoderPid?: number
  hlsOutput: string
  id: string
  mediaMtxPath: string
  resolution: string
  startedAt: number
  status: StreamStatus
  title: string
  viewers: number
}

export interface WatchSession {
  playbackState: 'loading' | 'ready' | 'playing'
  playbackUrl: string
  streamId: string
}
