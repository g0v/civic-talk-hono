import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers'
import type { EvidenceBindings } from './env'
import { runEvidenceWorkflow } from './runner'

/** 參數與 checkpoint 僅含工作／工件識別或狀態，不保存原文與模型回應。 */
export class EvidenceWorkflow extends WorkflowEntrypoint<EvidenceBindings, { jobId: string }> {
  async run(event: WorkflowEvent<{ jobId: string }>, step: WorkflowStep): Promise<{ status: string }> {
    if (!event.payload || typeof event.payload.jobId !== 'string' || Object.keys(event.payload).length !== 1) return { status: 'invalid_job' }
    return runEvidenceWorkflow(this.env, event.payload.jobId, step)
  }
}
