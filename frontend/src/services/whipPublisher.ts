export interface WhipPublishOptions {
  endpointUrl: string
  mediaStream: MediaStream
  onConnectionStateChange?: (state: RTCPeerConnectionState) => void
  signal?: AbortSignal
}

export class WhipPublisherSession {
  private readonly peerConnection: RTCPeerConnection
  private readonly resourceUrl?: string
  private stopped = false

  constructor(peerConnection: RTCPeerConnection, resourceUrl?: string) {
    this.peerConnection = peerConnection
    this.resourceUrl = resourceUrl
  }

  async stop(): Promise<void> {
    if (this.stopped) {
      return
    }

    this.stopped = true
    this.peerConnection.close()

    if (!this.resourceUrl) {
      return
    }

    await fetch(this.resourceUrl, {
      method: 'DELETE',
    })
  }
}

function assertWebRtcSupport(): void {
  if (!('RTCPeerConnection' in window)) {
    throw new Error('This browser does not support RTCPeerConnection.')
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Publishing was stopped.', 'AbortError')
  }
}

function resolveResourceUrl(endpointUrl: string, location: string | null): string | undefined {
  if (!location) {
    return undefined
  }

  return new URL(location, endpointUrl).toString()
}

function waitForIceGatheringComplete(
  peerConnection: RTCPeerConnection,
  signal?: AbortSignal,
): Promise<void> {
  if (peerConnection.iceGatheringState === 'complete') {
    return Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    let timeoutId = 0

    const cleanup = (): void => {
      window.clearTimeout(timeoutId)
      peerConnection.removeEventListener('icegatheringstatechange', handleIceGatheringStateChange)
      signal?.removeEventListener('abort', handleAbort)
    }

    const handleAbort = (): void => {
      cleanup()
      reject(new DOMException('Publishing was stopped.', 'AbortError'))
    }

    const handleIceGatheringStateChange = (): void => {
      if (peerConnection.iceGatheringState !== 'complete') {
        return
      }

      cleanup()
      resolve()
    }

    timeoutId = window.setTimeout(() => {
      cleanup()
      resolve()
    }, 5000)

    peerConnection.addEventListener('icegatheringstatechange', handleIceGatheringStateChange)
    signal?.addEventListener('abort', handleAbort, { once: true })
  })
}

function waitForPeerConnectionConnected(
  peerConnection: RTCPeerConnection,
  signal?: AbortSignal,
): Promise<void> {
  if (peerConnection.connectionState === 'connected') {
    return Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    let timeoutId = 0

    const cleanup = (): void => {
      window.clearTimeout(timeoutId)
      peerConnection.removeEventListener('connectionstatechange', handleConnectionStateChange)
      signal?.removeEventListener('abort', handleAbort)
    }

    const handleAbort = (): void => {
      cleanup()
      reject(new DOMException('Publishing was stopped.', 'AbortError'))
    }

    const handleConnectionStateChange = (): void => {
      if (peerConnection.connectionState === 'connected') {
        cleanup()
        resolve()
        return
      }

      if (peerConnection.connectionState === 'failed' || peerConnection.connectionState === 'closed') {
        cleanup()
        reject(new Error(`MediaMTX WebRTC connection ${peerConnection.connectionState}.`))
      }
    }

    timeoutId = window.setTimeout(() => {
      cleanup()
      reject(new Error('Timed out waiting for MediaMTX WebRTC media connection.'))
    }, 10000)

    peerConnection.addEventListener('connectionstatechange', handleConnectionStateChange)
    signal?.addEventListener('abort', handleAbort, { once: true })
    handleConnectionStateChange()
  })
}

async function readWhipError(response: Response): Promise<string> {
  const body = await response.text()
  const detail = body.trim()

  if (detail) {
    return detail
  }

  return `MediaMTX WHIP endpoint returned status ${response.status}.`
}

export async function publishMediaWithWhip(
  options: WhipPublishOptions,
): Promise<WhipPublisherSession> {
  assertWebRtcSupport()
  throwIfAborted(options.signal)

  const peerConnection = new RTCPeerConnection()
  let completed = false

  try {
    peerConnection.addEventListener('connectionstatechange', () => {
      options.onConnectionStateChange?.(peerConnection.connectionState)
    })

    options.mediaStream.getTracks().forEach((track) => {
      peerConnection.addTrack(track, options.mediaStream)
    })

    const offer = await peerConnection.createOffer()
    throwIfAborted(options.signal)

    await peerConnection.setLocalDescription(offer)
    await waitForIceGatheringComplete(peerConnection, options.signal)
    throwIfAborted(options.signal)

    if (!peerConnection.localDescription?.sdp) {
      throw new Error('Browser could not create a local WebRTC offer.')
    }

    const response = await fetch(options.endpointUrl, {
      body: peerConnection.localDescription.sdp,
      headers: {
        Accept: 'application/sdp',
        'Content-Type': 'application/sdp',
      },
      method: 'POST',
      signal: options.signal,
    })

    if (!response.ok) {
      throw new Error(await readWhipError(response))
    }

    const answerSdp = await response.text()
    if (answerSdp.trim() === '') {
      throw new Error('MediaMTX WHIP endpoint returned an empty SDP answer.')
    }

    await peerConnection.setRemoteDescription({
      sdp: answerSdp,
      type: 'answer',
    })

    await waitForPeerConnectionConnected(peerConnection, options.signal)

    completed = true
    return new WhipPublisherSession(
      peerConnection,
      resolveResourceUrl(options.endpointUrl, response.headers.get('Location')),
    )
  } finally {
    if (!completed) {
      peerConnection.close()
    }
  }
}
