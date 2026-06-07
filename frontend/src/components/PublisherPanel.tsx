import { useEffect, useMemo, useRef, useState } from 'react'
import type { BackendStreamStatus, PublisherState } from '../types'
import { ApiClientError, createStream, startPublishing, stopStream } from '../services/backendApi'
import { WhipPublisherSession, publishMediaWithWhip } from '../services/whipPublisher'
import { EmptyState } from './StreamsPanel'
import { Panel } from './Panel'

interface PublisherPanelProps {
  onStreamChanged: (stream: BackendStreamStatus) => void
}

const PUBLISHER_STATE_LABELS: Record<PublisherState, string> = {
  connecting: 'connecting',
  failed: 'failed',
  idle: 'idle',
  live: 'live',
  'requesting-permissions': 'permissions',
  stopped: 'stopped',
}

function defaultTitle(): string {
  return `Desk cam ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}

function canUseStreamForPublishing(
  stream?: BackendStreamStatus,
): stream is BackendStreamStatus {
  return stream?.state === 'created' || stream?.state === 'publishing'
}

function stopMediaTracks(mediaStream: MediaStream | null): void {
  mediaStream?.getTracks().forEach((track) => track.stop())
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function toPublisherErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    return `${error.code}: ${error.message}`
  }

  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') {
      return 'Camera or microphone permission was denied.'
    }

    if (error.name === 'NotFoundError') {
      return 'No matching camera or microphone was found.'
    }

    if (error.name === 'NotReadableError') {
      return 'Camera or microphone is already in use.'
    }

    if (error.name === 'AbortError') {
      return 'Publishing was stopped.'
    }
  }

  if (error instanceof Error) {
    if (error instanceof TypeError && error.message === 'Failed to fetch') {
      return 'Could not reach the MediaMTX WHIP endpoint. Start MediaMTX on port 8889 and trust/open its HTTPS URL in this browser.'
    }

    return error.message
  }

  return 'Publisher setup failed.'
}

function upsertStream(
  streams: BackendStreamStatus[],
  nextStream: BackendStreamStatus,
): BackendStreamStatus[] {
  const existingIndex = streams.findIndex((stream) => stream.streamId === nextStream.streamId)

  if (existingIndex === -1) {
    return [nextStream, ...streams]
  }

  const updatedStreams = [...streams]
  updatedStreams[existingIndex] = nextStream
  return updatedStreams
}

export function PublisherPanel({ onStreamChanged }: PublisherPanelProps) {
  const [createdStreams, setCreatedStreams] = useState<BackendStreamStatus[]>([])
  const [errorMessage, setErrorMessage] = useState<string>()
  const [includeAudio, setIncludeAudio] = useState(true)
  const [localMedia, setLocalMedia] = useState<MediaStream | null>(null)
  const [publisherState, setPublisherState] = useState<PublisherState>('idle')
  const [selectedStreamId, setSelectedStreamId] = useState('')
  const [title, setTitle] = useState(defaultTitle)
  const [userId, setUserId] = useState('user-123')

  const abortControllerRef = useRef<AbortController | null>(null)
  const localMediaRef = useRef<MediaStream | null>(null)
  const publisherSessionRef = useRef<WhipPublisherSession | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  const selectedStream = useMemo(
    () => createdStreams.find((stream) => stream.streamId === selectedStreamId),
    [createdStreams, selectedStreamId],
  )
  const isStarting =
    publisherState === 'requesting-permissions' || publisherState === 'connecting'
  const isActivePublisher = isStarting || publisherState === 'live'
  const canStart = !isActivePublisher

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = localMedia
    }
  }, [localMedia])

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort()
      publisherSessionRef.current?.stop().catch(() => undefined)
      stopMediaTracks(localMediaRef.current)
    }
  }, [])

  function rememberStream(stream: BackendStreamStatus): void {
    setCreatedStreams((currentStreams) => upsertStream(currentStreams, stream))
    setSelectedStreamId(stream.streamId)
    onStreamChanged(stream)
  }

  async function createStreamRecord(): Promise<BackendStreamStatus> {
    const response = await createStream({
      publisherUserId: userId.trim() || undefined,
      title: title.trim() || 'Untitled stream',
    })

    rememberStream(response.stream)
    return response.stream
  }

  async function ensurePublishTarget(): Promise<BackendStreamStatus> {
    if (canUseStreamForPublishing(selectedStream)) {
      return selectedStream
    }

    return createStreamRecord()
  }

  function assertCaptureSupport(): void {
    if (!window.isSecureContext) {
      throw new Error('Camera capture requires HTTPS or localhost.')
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('This browser does not support camera capture.')
    }
  }

  async function requestLocalMedia(): Promise<MediaStream> {
    assertCaptureSupport()

    return navigator.mediaDevices.getUserMedia({
      audio: includeAudio
        ? {
            echoCancellation: true,
            noiseSuppression: true,
          }
        : false,
      video: {
        frameRate: {
          ideal: 30,
          max: 30,
        },
        height: {
          ideal: 720,
        },
        width: {
          ideal: 1280,
        },
      },
    })
  }

  async function handleCreateStream(): Promise<void> {
    if (isActivePublisher) {
      return
    }

    setErrorMessage(undefined)

    try {
      await createStreamRecord()
      setPublisherState('idle')
    } catch (error) {
      setErrorMessage(toPublisherErrorMessage(error))
      setPublisherState('failed')
    }
  }

  async function handleStartPublishing(): Promise<void> {
    if (!canStart) {
      return
    }

    const abortController = new AbortController()
    abortControllerRef.current = abortController
    setErrorMessage(undefined)

    try {
      const stream = await ensurePublishTarget()

      setPublisherState('requesting-permissions')
      const mediaStream = await requestLocalMedia()
      localMediaRef.current = mediaStream
      setLocalMedia(mediaStream)

      setPublisherState('connecting')
      const publishStart = await startPublishing(stream.streamId, {
        userId: userId.trim() || 'anonymous-publisher',
      })
      rememberStream(publishStart.stream)

      publisherSessionRef.current = await publishMediaWithWhip({
        endpointUrl: publishStart.whipUrl,
        mediaStream,
        onConnectionStateChange: (state) => {
          if (state === 'connected') {
            setPublisherState('live')
            return
          }

          if (state === 'failed' || state === 'disconnected') {
            setErrorMessage(`MediaMTX WebRTC connection ${state}.`)
            setPublisherState('failed')
          }
        },
        signal: abortController.signal,
      })

      setPublisherState('live')
    } catch (error) {
      if (isAbortError(error)) {
        setPublisherState('stopped')
      } else {
        setErrorMessage(toPublisherErrorMessage(error))
        setPublisherState('failed')
      }

      stopMediaTracks(localMediaRef.current)
      localMediaRef.current = null
      setLocalMedia(null)
    } finally {
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null
      }
    }
  }

  async function handleStopPublishing(): Promise<void> {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null

    const activeSession = publisherSessionRef.current
    publisherSessionRef.current = null

    setErrorMessage(undefined)

    try {
      await activeSession?.stop()
    } catch (error) {
      setErrorMessage(toPublisherErrorMessage(error))
    } finally {
      stopMediaTracks(localMediaRef.current)
      localMediaRef.current = null
      setLocalMedia(null)
    }

    if (selectedStream) {
      try {
        const response = await stopStream(selectedStream.streamId)
        rememberStream(response.stream)
      } catch (error) {
        setErrorMessage(toPublisherErrorMessage(error))
      }
    }

    setPublisherState('stopped')
  }

  return (
    <Panel badge={PUBLISHER_STATE_LABELS[publisherState]} title="Publisher">
      <div className="publisher-grid">
        <div className="publisher-preview">
          {localMedia ? (
            <video aria-label="Local camera preview" autoPlay muted playsInline ref={videoRef} />
          ) : (
            <EmptyState title="Camera idle" message="Create a stream target or start publishing." />
          )}
        </div>

        <div className="publisher-form" aria-label="Publisher controls">
          <label className="field">
            <span>Stream title</span>
            <input
              disabled={isActivePublisher}
              onChange={(event) => setTitle(event.target.value)}
              type="text"
              value={title}
            />
          </label>

          <label className="field">
            <span>Publisher ID</span>
            <input
              disabled={isActivePublisher}
              onChange={(event) => setUserId(event.target.value)}
              type="text"
              value={userId}
            />
          </label>

          <label className="field">
            <span>Stream target</span>
            <select
              disabled={isActivePublisher || createdStreams.length === 0}
              onChange={(event) => setSelectedStreamId(event.target.value)}
              value={selectedStreamId}
            >
              <option value="">New stream target</option>
              {createdStreams.map((stream) => (
                <option key={stream.streamId} value={stream.streamId}>
                  {stream.streamId} - {stream.state}
                </option>
              ))}
            </select>
          </label>

          <label className="toggle-row">
            <input
              checked={includeAudio}
              disabled={isActivePublisher}
              onChange={(event) => setIncludeAudio(event.target.checked)}
              type="checkbox"
            />
            <span>Microphone</span>
          </label>

          <div className="publisher-summary" aria-label="Publish target details">
            {selectedStream ? (
              <>
                <InfoRow label="Stream ID" value={selectedStream.streamId} mono />
                <InfoRow label="MediaMTX path" value={selectedStream.relay.mediaMtxPath} mono />
                <InfoRow label="WHIP endpoint" value={selectedStream.relay.whipUrl} mono />
                <InfoRow label="Backend state" value={selectedStream.state} />
              </>
            ) : (
              <InfoRow label="Stream ID" value="pending" />
            )}
          </div>

          {errorMessage ? <p className="error-banner">{errorMessage}</p> : null}

          <div className="button-group">
            <button
              className="btn btn-secondary"
              disabled={isActivePublisher}
              onClick={handleCreateStream}
              type="button"
            >
              <span aria-hidden="true">+</span>
              Create
            </button>
            <button
              className="btn btn-primary"
              disabled={!canStart}
              onClick={handleStartPublishing}
              type="button"
            >
              <span aria-hidden="true">&gt;</span>
              Start
            </button>
            <button
              className="btn btn-secondary"
              disabled={!isActivePublisher && !localMedia}
              onClick={handleStopPublishing}
              type="button"
            >
              <span aria-hidden="true">x</span>
              Stop
            </button>
          </div>
        </div>
      </div>
    </Panel>
  )
}

interface InfoRowProps {
  label: string
  mono?: boolean
  value: string
}

function InfoRow({ label, mono, value }: InfoRowProps) {
  return (
    <div className="info-row">
      <span className="label">{label}</span>
      <span className={`value ${mono ? 'mono' : ''}`}>{value}</span>
    </div>
  )
}
