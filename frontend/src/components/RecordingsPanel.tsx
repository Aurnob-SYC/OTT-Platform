import type { BackendRecording } from '../types'
import { formatDateTime, formatDuration } from '../utils/format'
import { Panel } from './Panel'
import { EmptyState } from './StreamsPanel'

interface RecordingsPanelProps {
  activeRecordingId?: string
  deletingRecordingId?: string
  errorMessage?: string
  isRefreshing: boolean
  onDeleteRecording: (recording: BackendRecording) => void
  onPlayRecording: (recording: BackendRecording) => void
  onRefresh: () => void
  recordings: BackendRecording[]
}

export function RecordingsPanel({
  activeRecordingId,
  deletingRecordingId,
  errorMessage,
  isRefreshing,
  onDeleteRecording,
  onPlayRecording,
  onRefresh,
  recordings,
}: RecordingsPanelProps) {
  return (
    <Panel badge={`${recordings.length} saved`} title="Recorded Videos">
      <div className="stream-panel-tools">
        <span>{isRefreshing ? 'Refreshing recordings' : 'Packaged VOD archive'}</span>
        <button className="btn btn-secondary compact" onClick={onRefresh} type="button">
          <span aria-hidden="true">R</span>
          Refresh
        </button>
      </div>

      {errorMessage ? <p className="error-banner">{errorMessage}</p> : null}

      {recordings.length === 0 ? (
        <EmptyState title="No recordings yet" message="Stop a live stream after packaging to see it here." />
      ) : (
        <div className="recording-list">
          {recordings.map((recording) => (
            <RecordingRow
              isActive={recording.recordingId === activeRecordingId}
              isDeleting={recording.recordingId === deletingRecordingId}
              key={recording.recordingId}
              onDelete={onDeleteRecording}
              onPlay={onPlayRecording}
              recording={recording}
            />
          ))}
        </div>
      )}
    </Panel>
  )
}

interface RecordingRowProps {
  isActive: boolean
  isDeleting: boolean
  onDelete: (recording: BackendRecording) => void
  onPlay: (recording: BackendRecording) => void
  recording: BackendRecording
}

function RecordingRow({ isActive, isDeleting, onDelete, onPlay, recording }: RecordingRowProps) {
  return (
    <article className={`recording-row ${isActive ? 'active' : ''}`}>
      <div className="recording-main">
        <div>
          <h3>{recording.title}</h3>
          <p>
            Created {formatDateTime(recording.createdAt)} · {formatDuration(recording.durationSeconds)}
          </p>
        </div>
        <span className="stream-status-tag packaged">{recording.state.toUpperCase()}</span>
      </div>

      <div className="recording-paths">
        <span>
          VOD <code>/vod/{recording.recordingId}/master.m3u8</code>
        </span>
        <span>
          Source <code>{recording.sourceStreamId}</code>
        </span>
      </div>

      <div className="recording-actions">
        <button className="btn btn-primary compact" onClick={() => onPlay(recording)} type="button">
          <span aria-hidden="true">&gt;</span>
          {isActive ? 'Playing' : 'Play'}
        </button>
        <button
          className="btn btn-secondary compact danger"
          disabled={isDeleting}
          onClick={() => onDelete(recording)}
          type="button"
        >
          <span aria-hidden="true">x</span>
          {isDeleting ? 'Deleting' : 'Delete'}
        </button>
      </div>
    </article>
  )
}
