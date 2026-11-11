-- #210：摘要正文只保存在業務議題，申請與完成均以議題、語言及 generation 序列化。
ALTER TABLE ct_issues ADD COLUMN ai_summaries TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(ai_summaries));

CREATE TABLE ct_ai_summary_slots (
  issue_id INTEGER NOT NULL REFERENCES ct_issues(id) ON DELETE CASCADE,
  language TEXT NOT NULL CHECK (language IN ('zh-TW', 'en', 'ja')),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  job_id TEXT REFERENCES ct_ai_jobs(id),
  PRIMARY KEY (issue_id, language)
);

-- 只複製最新申請且已完整完成的工件；直接取自受信任的 pipeline，絕不接受呼叫端正文。
-- 工作先完成或先註冊均會觸發此步驟，寫入及版本遞增與觸發的交易原子提交。
CREATE TRIGGER ct_ai_summary_save AFTER UPDATE OF job_id ON ct_ai_summary_slots
WHEN NEW.job_id IS NOT NULL
BEGIN
  UPDATE ct_issues
  SET ai_summaries = json_set(ai_summaries, '$."' || NEW.language || '"', json((
    SELECT json_object(
      'job_id', j.id, 'owner_id', j.owner_id, 'execution_id', e.id, 'artifact_id', a.id,
      'data', json_extract(a.payload, '$.data'), 'citation_map', json_extract(a.payload, '$.citation_map'),
      'verification', 'ai_unverified', 'updated_at', e.updated_at
    )
    FROM ct_ai_jobs j JOIN ct_ai_executions e ON e.id = j.execution_id
    JOIN ct_ai_artifacts a ON a.id = e.artifact_id AND a.execution_id = e.id
    WHERE j.id = NEW.job_id AND e.issue_id = NEW.issue_id AND e.language = NEW.language
      AND e.status = 'ai_draft' AND a.kind = 'generation' AND a.payload IS NOT NULL
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
      AND e.status = 'ai_draft' AND a.kind = 'generation' AND a.payload IS NOT NULL
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
WHEN NEW.status = 'ai_draft' AND OLD.status <> 'ai_draft'
BEGIN
  UPDATE ct_ai_summary_slots SET job_id = job_id
  WHERE issue_id = NEW.issue_id AND language = NEW.language
    AND job_id IN (SELECT id FROM ct_ai_jobs WHERE execution_id = NEW.id);
END;

-- 撤下或清除來源時，同一交易移除複本並遞增版本；舊執行即使遲到也無法復活內容。
CREATE TRIGGER ct_ai_summary_withdraw AFTER UPDATE OF status ON ct_ai_executions
WHEN NEW.status IN ('withdrawn', 'erased')
BEGIN
  UPDATE ct_ai_summary_slots SET version = version + 1
  WHERE issue_id = NEW.issue_id AND EXISTS (
    SELECT 1 FROM ct_issues i WHERE i.id = NEW.issue_id
      AND json_extract(i.ai_summaries, '$."' || ct_ai_summary_slots.language || '".execution_id') = NEW.id
  );
  UPDATE ct_issues SET ai_summaries = json_remove(ai_summaries,
    CASE WHEN json_extract(ai_summaries, '$."zh-TW".execution_id') = NEW.id THEN '$."zh-TW"' ELSE '$.__absent_zh' END,
    CASE WHEN json_extract(ai_summaries, '$."en".execution_id') = NEW.id THEN '$."en"' ELSE '$.__absent_en' END,
    CASE WHEN json_extract(ai_summaries, '$."ja".execution_id') = NEW.id THEN '$."ja"' ELSE '$.__absent_ja' END)
  WHERE id = NEW.issue_id;
END;
