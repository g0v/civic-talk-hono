import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers'
import { hasEvidenceBindings, withEvidenceSource, type EvidenceRuntimeBindings } from './env'
import { runEvidenceWorkflow } from './runner'

/** 參數與 checkpoint 僅含工作／工件識別或狀態，不保存原文與模型回應。 */
export class EvidenceWorkflow extends WorkflowEntrypoint<EvidenceRuntimeBindings, { jobId: string }> {
  async run(event: WorkflowEvent<{ jobId: string }>, step: WorkflowStep): Promise<{ status: string }> {
    // 手動建立的 instance 也不能繞過預設關閉的功能開關或缺少必要 capability。
    if (this.env.EVIDENCE_API_ENABLED !== '1') return { status: 'disabled' }
    if (!hasEvidenceBindings(this.env)) return { status: 'service_unavailable' }
    if (!event.payload || typeof event.payload.jobId !== 'string' || Object.keys(event.payload).length !== 1) return { status: 'invalid_job' }
    return runEvidenceWorkflow(withEvidenceSource(this.env), event.payload.jobId, step)
  }
}
