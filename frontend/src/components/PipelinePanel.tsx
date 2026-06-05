import { PIPELINE_STEPS } from '../data/pipeline'
import type { PipelineStage, PipelineStep } from '../types'
import { Panel } from './Panel'

const STAGE_LABELS: Record<PipelineStage, string> = {
  encode: 'encode',
  publish: 'publish',
  serve: 'serve',
  watch: 'watch',
}

interface PipelinePanelProps {
  activeStage: PipelineStage
  isPlaying: boolean
}

export function PipelinePanel({ activeStage, isPlaying }: PipelinePanelProps) {
  return (
    <Panel badge={STAGE_LABELS[activeStage]} title="End-to-End Pipeline">
      <ol className="pipeline" aria-label="Live streaming pipeline">
        {PIPELINE_STEPS.map((step) => (
          <PipelineStepRow
            activeStage={activeStage}
            isPlaying={isPlaying}
            key={step.id}
            step={step}
          />
        ))}
      </ol>
    </Panel>
  )
}

interface PipelineStepRowProps {
  activeStage: PipelineStage
  isPlaying: boolean
  step: PipelineStep
}

function PipelineStepRow({ activeStage, isPlaying, step }: PipelineStepRowProps) {
  const isStageActive = step.stage === activeStage && step.status !== 'idle'
  const isPlayerStep = step.id === 12 && isPlaying
  const dotClass = isPlayerStep || isStageActive ? 'busy' : step.status === 'idle' ? 'offline' : 'online'

  return (
    <li className={`pipeline-step stage-${step.stage}`}>
      <span className="step-num">{step.id}</span>
      <span className="step-copy">
        <span className="step-actor">{step.actor}</span>
        <span className="step-action">
          {step.description}
          {step.code ? (
            <>
              {' '}
              <code>{step.code}</code>
            </>
          ) : null}
        </span>
      </span>
      <span className="step-state" aria-label={dotClass}>
        <span className={`state-dot ${dotClass}`} />
      </span>
    </li>
  )
}
