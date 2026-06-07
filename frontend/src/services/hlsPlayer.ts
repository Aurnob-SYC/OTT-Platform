import Hls from 'hls.js'

interface AttachHlsStreamInput {
  onAutoplayBlocked: (message: string) => void
  onError: (message: string) => void
  onPlaying: () => void
  onReady: () => void
  sourceUrl: string
  video: HTMLVideoElement
}

export interface HlsPlayerHandle {
  play: () => Promise<void>
  stop: () => void
}

interface HlsErrorData {
  details?: string
  fatal?: boolean
  type?: string
}

function isAutoplayBlocked(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotAllowedError'
}

function toPlaybackErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return 'Playback is ready. Use Play Stream to start video in this browser.'
  }

  if (error instanceof Error) {
    return error.message
  }

  return 'HLS playback failed.'
}

function playVideo(
  video: HTMLVideoElement,
  onAutoplayBlocked: (message: string) => void,
  onPlaying: () => void,
  onError: (message: string) => void,
): Promise<void> {
  return video
    .play()
    .then(onPlaying)
    .catch((error: unknown) => {
      if (isAutoplayBlocked(error)) {
        onAutoplayBlocked(toPlaybackErrorMessage(error))
        return
      }

      onError(toPlaybackErrorMessage(error))
    })
}

export function attachHlsStream({
  onAutoplayBlocked,
  onError,
  onPlaying,
  onReady,
  sourceUrl,
  video,
}: AttachHlsStreamInput): HlsPlayerHandle {
  let hls: Hls | null = null

  const handlePlaying = () => onPlaying()
  const handleNativeReady = () => {
    onReady()
    void playVideo(video, onAutoplayBlocked, onPlaying, onError)
  }
  const handleNativeError = () => onError('The browser could not play this HLS stream.')

  video.pause()
  video.removeAttribute('src')
  video.load()

  if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = sourceUrl
    video.addEventListener('loadedmetadata', handleNativeReady)
    video.addEventListener('playing', handlePlaying)
    video.addEventListener('error', handleNativeError)
  } else if (Hls.isSupported()) {
    hls = new Hls({
      liveSyncDurationCount: 3,
    })

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      onReady()
      void playVideo(video, onAutoplayBlocked, onPlaying, onError)
    })
    hls.on(Hls.Events.ERROR, (_event, data: HlsErrorData) => {
      if (data.fatal) {
        onError(`HLS ${data.type || 'playback'} error: ${data.details || 'unknown failure'}.`)
      }
    })
    hls.attachMedia(video)
    hls.loadSource(sourceUrl)
    video.addEventListener('playing', handlePlaying)
  } else {
    onError('This browser does not support HLS playback.')
  }

  return {
    play: () => playVideo(video, onAutoplayBlocked, onPlaying, onError),
    stop: () => {
      video.removeEventListener('loadedmetadata', handleNativeReady)
      video.removeEventListener('playing', handlePlaying)
      video.removeEventListener('error', handleNativeError)
      hls?.destroy()
      hls = null
      video.pause()
      video.removeAttribute('src')
      video.load()
    },
  }
}
