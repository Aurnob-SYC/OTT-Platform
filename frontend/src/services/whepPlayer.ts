interface AttachWhepStreamInput {
  onAutoplayBlocked: (message: string) => void
  onError: (message: string) => void
  onPlaying: () => void
  onReady: () => void
  sourceUrl: string
  video: HTMLVideoElement
}

export interface WhepPlayerHandle {
  play: () => Promise<void>
  stop: () => void
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

  return 'WHEP playback failed.'
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

function waitForIceGatheringComplete(peerConnection: RTCPeerConnection): Promise<void> {
  if (peerConnection.iceGatheringState === 'complete') {
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    const handleStateChange = () => {
      if (peerConnection.iceGatheringState !== 'complete') {
        return
      }

      peerConnection.removeEventListener('icegatheringstatechange', handleStateChange)
      resolve()
    }

    peerConnection.addEventListener('icegatheringstatechange', handleStateChange)
  })
}

export function attachWhepStream({
  onAutoplayBlocked,
  onError,
  onPlaying,
  onReady,
  sourceUrl,
  video,
}: AttachWhepStreamInput): WhepPlayerHandle {
  const controller = new AbortController()
  const stream = new MediaStream()
  let stopped = false
  let peerConnection: RTCPeerConnection | null = null

  function cleanupVideo(): void {
    const currentStream = video.srcObject instanceof MediaStream ? video.srcObject : null

    if (currentStream) {
      currentStream.getTracks().forEach((track) => track.stop())
    }

    video.pause()
    video.srcObject = null
    video.load()
  }

  async function connect(): Promise<void> {
    try {
      if (stopped) {
        return
      }

      if (typeof RTCPeerConnection === 'undefined') {
        throw new Error('This browser does not support WebRTC playback.')
      }

      const connection = new RTCPeerConnection()
      peerConnection = connection
      connection.addTransceiver('video', { direction: 'recvonly' })
      connection.addTransceiver('audio', { direction: 'recvonly' })

      connection.ontrack = (event) => {
        stream.addTrack(event.track)
        video.srcObject = stream
      }

      const offer = await connection.createOffer()
      if (stopped) {
        return
      }

      await connection.setLocalDescription(offer)
      await waitForIceGatheringComplete(connection)

      if (stopped) {
        return
      }

      const localDescription = connection.localDescription
      if (!localDescription?.sdp) {
        throw new Error('Could not create a WHEP offer.')
      }

      const response = await fetch(sourceUrl, {
        body: localDescription.sdp,
        headers: {
          Accept: 'application/sdp',
          'Content-Type': 'application/sdp',
        },
        method: 'POST',
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new Error(`WHEP request failed with status ${response.status}.`)
      }

      const answer = await response.text()
      if (stopped) {
        return
      }

      if (answer.trim() === '') {
        throw new Error('WHEP server returned an empty answer.')
      }

      await connection.setRemoteDescription({
        sdp: answer,
        type: 'answer',
      })

      if (stopped) {
        return
      }

      onReady()
      void playVideo(video, onAutoplayBlocked, onPlaying, onError)
    } catch (error) {
      if (stopped || (error instanceof DOMException && error.name === 'AbortError')) {
        return
      }

      if (peerConnection) {
        peerConnection.ontrack = null
        peerConnection.close()
        peerConnection = null
      }

      cleanupVideo()
      onError(toPlaybackErrorMessage(error))
    }
  }

  cleanupVideo()
  void connect()

  return {
    play: () => playVideo(video, onAutoplayBlocked, onPlaying, onError),
    stop: () => {
      stopped = true
      controller.abort()
      if (peerConnection) {
        peerConnection.ontrack = null
        peerConnection.close()
        peerConnection = null
      }
      cleanupVideo()
    },
  }
}
