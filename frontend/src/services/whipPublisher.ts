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

  /**
   * Stores the peer connection and optional WHIP resource URL for later cleanup.
   * @param peerConnection - The active WebRTC peer connection used for publishing.
   * @param resourceUrl - Optional WHIP resource URL that can be deleted on stop.
   */
  constructor(peerConnection: RTCPeerConnection, resourceUrl?: string) {
    this.peerConnection = peerConnection
    this.resourceUrl = resourceUrl
  }

  /**
   * Closes the WebRTC connection and deletes the WHIP resource if one was returned.
   * @returns {Promise<void>} Resolves after cleanup finishes or immediately if already stopped.
   */
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

/**
 * Ensures the current browser supports the WebRTC peer connection API.
 * @returns {void}
 */
function assertWebRtcSupport(): void {
  if (!('RTCPeerConnection' in window)) {
    throw new Error('This browser does not support RTCPeerConnection.')
  }
}

/**
 * Throws an AbortError when the caller has already cancelled the publish flow.
 * @param signal - Optional abort signal from the caller.
 * @returns {void}
 */
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Publishing was stopped.', 'AbortError')
  }
}

/**
 * Resolves a WHIP Location header into an absolute resource URL.
 * @param endpointUrl - The WHIP endpoint that was used for the publish request.
 * @param location - The Location header returned by the server, if any.
 * @returns {string | undefined} The absolute resource URL, or undefined when the server did not provide one.
 */
function resolveResourceUrl(endpointUrl: string, location: string | null): string | undefined {
  if (!location) {
    return undefined
  }

  return new URL(location, endpointUrl).toString()
}

/**
 * Waits until ICE gathering finishes so the full SDP offer can be sent to WHIP.
 * @param peerConnection - The peer connection performing candidate gathering.
 * @param signal - Optional abort signal to cancel the wait.
 * @returns {Promise<void>} Resolves when gathering completes or times out.
 */
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

/**
 * Waits until the peer connection reaches the connected state or fails.
 * @param peerConnection - The peer connection being monitored.
 * @param signal - Optional abort signal to cancel the wait.
 * @returns {Promise<void>} Resolves when connected, or rejects on failure or timeout.
 */
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

/**
 * Reads a non-OK WHIP response and turns it into a useful error message.
 * @param response - The HTTP response returned by the WHIP endpoint.
 * @returns {Promise<string>} A human-readable error message.
 */
async function readWhipError(response: Response): Promise<string> {
  const body = await response.text()
  const detail = body.trim()

  if (detail) {
    return detail
  }

  return `MediaMTX WHIP endpoint returned status ${response.status}.`
}

/**
 * Publishes a MediaStream to MediaMTX using the WHIP protocol.
 * @param options - Publish settings including endpoint URL, media stream, and abort support.
 * @returns {Promise<WhipPublisherSession>} A session object that can later stop the publish flow.
 */
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
