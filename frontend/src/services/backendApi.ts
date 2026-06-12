import type { BackendRecording, BackendStreamStatus, ViewerPlaybackSet } from '../types'

const DEFAULT_API_BASE_URL = '/api'

interface ApiErrorBody {
  error?: string
  message?: string
}

interface CreateStreamResponse {
  publishPath: string
  stream: BackendStreamStatus
  streamId: string
}

interface PublishStartResponse {
  publishPath: string
  publishUrl: string
  stream: BackendStreamStatus
  success: boolean
  whipUrl: string
}

interface EncoderStartResponse {
  pid: number | null
  renditions: string[]
  stream: BackendStreamStatus
  success: boolean
}

interface StopStreamResponse {
  clearedViewerSessions: number
  stream: BackendStreamStatus
  success: boolean
}

interface ListStreamsResponse {
  active: BackendStreamStatus[]
  recent: BackendStreamStatus[]
  streams: BackendStreamStatus[]
}

interface ListRecordingsResponse {
  recordings: BackendRecording[]
}

interface DeleteRecordingResponse {
  recording: BackendRecording
  success: boolean
}

interface StartViewerSessionResponse {
  playback: ViewerPlaybackSet
  previousStreamId: string | null
  session: {
    playbackUrl: string
    startedAt: string
    streamId: string
    updatedAt: string
    viewerId: string
  }
  streamId: string
  success: boolean
  viewerId: string
}

interface StopViewerSessionResponse {
  stoppedStreamId: string | null
  success: boolean
  viewerId: string
}

export interface CreateStreamInput {
  publisherUserId?: string
  title: string
}

export interface StartPublishingInput {
  userId: string
}

export interface StartEncoderInput {
  renditions?: string[]
  waitForRelayReady?: boolean
}

export class ApiClientError extends Error {
  code: string
  statusCode: number

  constructor(statusCode: number, code: string, message: string) {
    super(message)
    this.name = 'ApiClientError'
    this.code = code
    this.statusCode = statusCode
  }
}

function getApiBaseUrl(): string {
  const configuredBaseUrl = import.meta.env.VITE_BACKEND_API_BASE_URL

  if (configuredBaseUrl && configuredBaseUrl.trim() !== '') {
    return configuredBaseUrl.trim().replace(/\/+$/, '')
  }

  return DEFAULT_API_BASE_URL
}

function buildApiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${getApiBaseUrl()}${normalizedPath}`
}

async function readErrorBody(response: Response): Promise<ApiErrorBody> {
  try {
    return (await response.json()) as ApiErrorBody
  } catch {
    return {}
  }
}

async function requestJson<ResponseBody>(
  path: string,
  init: RequestInit = {},
): Promise<ResponseBody> {
  const response = await fetch(buildApiUrl(path), {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  })

  if (!response.ok) {
    const body = await readErrorBody(response)
    throw new ApiClientError(
      response.status,
      body.error || 'API_REQUEST_FAILED',
      body.message || `Backend API request failed with status ${response.status}.`,
    )
  }

  return (await response.json()) as ResponseBody
}

export async function createStream(input: CreateStreamInput): Promise<CreateStreamResponse> {
  return requestJson<CreateStreamResponse>('/streams', {
    body: JSON.stringify(input),
    method: 'POST',
  })
}

export async function listStreams(): Promise<ListStreamsResponse> {
  return requestJson<ListStreamsResponse>('/streams')
}

export async function listRecordings(): Promise<ListRecordingsResponse> {
  return requestJson<ListRecordingsResponse>('/recordings')
}

export async function startPublishing(
  streamId: string,
  input: StartPublishingInput,
): Promise<PublishStartResponse> {
  return requestJson<PublishStartResponse>(`/streams/${encodeURIComponent(streamId)}/publish/start`, {
    body: JSON.stringify(input),
    method: 'POST',
  })
}

export async function startEncoder(
  streamId: string,
  input: StartEncoderInput = {},
): Promise<EncoderStartResponse> {
  return requestJson<EncoderStartResponse>(`/streams/${encodeURIComponent(streamId)}/encoder/start`, {
    body: JSON.stringify(input),
    method: 'POST',
  })
}

export async function stopStream(streamId: string): Promise<StopStreamResponse> {
  return requestJson<StopStreamResponse>(`/streams/${encodeURIComponent(streamId)}/stop`, {
    method: 'POST',
  })
}

export async function deleteRecording(recordingId: string): Promise<DeleteRecordingResponse> {
  return requestJson<DeleteRecordingResponse>(`/recordings/${encodeURIComponent(recordingId)}`, {
    method: 'DELETE',
  })
}

export async function startViewerSession(
  viewerId: string,
  streamId: string,
): Promise<StartViewerSessionResponse> {
  return requestJson<StartViewerSessionResponse>('/viewer/session', {
    body: JSON.stringify({ streamId, viewerId }),
    method: 'POST',
  })
}

export async function stopViewerSession(
  viewerId: string,
  options: { keepalive?: boolean } = {},
): Promise<StopViewerSessionResponse> {
  return requestJson<StopViewerSessionResponse>('/viewer/session', {
    body: JSON.stringify({ viewerId }),
    keepalive: options.keepalive,
    method: 'DELETE',
  })
}
