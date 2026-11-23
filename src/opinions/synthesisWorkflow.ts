import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers'
import type { AppBindings } from '../api/types'
import { runOpinionSynthesisJob, type OpinionSynthesisJob } from './synthesis'

// Workflow payload 與 checkpoint 不保存正文、帳號或逐人投票。
export class OpinionSynthesisWorkflow extends WorkflowEntrypoint<AppBindings, OpinionSynthesisJob> {
  async run(event: WorkflowEvent<OpinionSynthesisJob>, step: WorkflowStep): Promise<void> {
    await step.do('generate-opinion-synthesis', { retries: { limit: 0, delay: '1 second' }, timeout: '10 minutes' }, async () => {
      await runOpinionSynthesisJob(this.env, event.payload)
      return null
    })
  }
}
