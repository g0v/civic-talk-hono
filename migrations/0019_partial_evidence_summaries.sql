-- partial 只填補空語言 slot；完整結果仍由最新註冊工作原子更新。
DROP TRIGGER ct_ai_summary_save;
DROP TRIGGER ct_ai_summary_complete;

CREATE TRIGGER ct_ai_summary_save AFTER UPDATE OF job_id ON ct_ai_summary_slots
WHEN NEW.job_id IS NOT NULL
BEGIN
  UPDATE ct_issues
  SET ai_summaries = json_set(ai_summaries, '$."' || NEW.language || '"', json((
    SELECT json_object(
      'job_id', j.id, 'owner_id', j.owner_id, 'execution_id', e.id, 'artifact_id', a.id,
      'data', json_extract(a.payload, '$.data'), 'citation_map', json_extract(a.payload, '$.citation_map'),
      'status', e.status, 'review_required', json('true'),
      'verification', 'ai_unverified', 'updated_at', e.updated_at
    )
    FROM ct_ai_jobs j JOIN ct_ai_executions e ON e.id = j.execution_id
    JOIN ct_ai_artifacts a ON a.id = e.artifact_id AND a.execution_id = e.id
    WHERE j.id = NEW.job_id AND e.issue_id = NEW.issue_id AND e.language = NEW.language
      AND e.status IN ('ai_draft', 'partial_draft')
      AND (e.status = 'ai_draft' OR json_type(ai_summaries, '$."' || NEW.language || '"') IS NULL)
      AND a.kind = 'generation' AND a.payload IS NOT NULL
      AND json_type(a.payload, '$.data') = 'object' AND json_type(a.payload, '$.citation_map') = 'array'
      AND json_type(a.payload, '$.evidence') = 'array' AND json_extract(a.payload, '$.verification') = 'ai_unverified'
      AND EXISTS (SELECT 1 FROM ct_ai_sources s WHERE s.execution_id = e.id)
      AND NOT EXISTS (
        SELECT 1 FROM ct_ai_sources s LEFT JOIN ct_ai_source_fences f
          ON f.namespace = s.namespace AND f.kind = s.kind AND f.source_id = s.source_id
        WHERE s.execution_id = e.id AND (f.generation IS NULL OR f.erased_at IS NOT NULL OR f.generation <> s.generation OR s.payload IS NULL)
      )
  )))
  WHERE id = NEW.issue_id AND EXISTS (
    SELECT 1 FROM ct_ai_jobs j JOIN ct_ai_executions e ON e.id = j.execution_id
    JOIN ct_ai_artifacts a ON a.id = e.artifact_id AND a.execution_id = e.id
    WHERE j.id = NEW.job_id AND e.issue_id = NEW.issue_id AND e.language = NEW.language
      AND e.status IN ('ai_draft', 'partial_draft')
      AND (e.status = 'ai_draft' OR json_type(ai_summaries, '$."' || NEW.language || '"') IS NULL)
      AND a.kind = 'generation' AND a.payload IS NOT NULL
      AND json_type(a.payload, '$.data') = 'object' AND json_type(a.payload, '$.citation_map') = 'array'
      AND json_type(a.payload, '$.evidence') = 'array' AND json_extract(a.payload, '$.verification') = 'ai_unverified'
      AND EXISTS (SELECT 1 FROM ct_ai_sources s WHERE s.execution_id = e.id)
      AND NOT EXISTS (
        SELECT 1 FROM ct_ai_sources s LEFT JOIN ct_ai_source_fences f
          ON f.namespace = s.namespace AND f.kind = s.kind AND f.source_id = s.source_id
        WHERE s.execution_id = e.id AND (f.generation IS NULL OR f.erased_at IS NOT NULL OR f.generation <> s.generation OR s.payload IS NULL)
      )
      AND (json_extract(ai_summaries, '$."' || NEW.language || '".job_id') IS NOT j.id
        OR json_extract(ai_summaries, '$."' || NEW.language || '".artifact_id') IS NOT a.id)
  );
  UPDATE ct_ai_summary_slots SET version = version + 1
  WHERE issue_id = NEW.issue_id AND language = NEW.language AND changes() > 0;
END;

CREATE TRIGGER ct_ai_summary_complete AFTER UPDATE OF status ON ct_ai_executions
WHEN NEW.status IN ('ai_draft', 'partial_draft') AND OLD.status <> NEW.status
BEGIN
  UPDATE ct_ai_summary_slots SET job_id = job_id
  WHERE issue_id = NEW.issue_id AND language = NEW.language
    AND job_id IN (SELECT id FROM ct_ai_jobs WHERE execution_id = NEW.id);
END;
