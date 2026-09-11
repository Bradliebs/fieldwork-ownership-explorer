import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import type { Investigation, InvestigationEvent } from '../../../packages/contracts/src/investigation.ts';
import { compareRevisions } from '../../../packages/contracts/src/revision.ts';
import { api } from './api.ts';

function display(value: unknown): string {
  if (value === undefined) return 'Not present';
  if (value === '') return '(empty)';
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

export function RevisionHistory({ id, history }: { id: string; history: InvestigationEvent[] }) {
  const [expanded, setExpanded] = useState(false);
  const [revision, setRevision] = useState(history[0]?.revision ?? 0);
  const [baseline, setBaseline] = useState(history[1]?.revision ?? -1);
  const [records, setRecords] = useState<{ before: Investigation | null; after: Investigation } | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!expanded) return;
    const controller = new AbortController();
    setRecords(null); setError('');
    Promise.all([
      baseline < 0 ? Promise.resolve(null) : api<{ investigation: Investigation }>(`/api/investigations/${id}/revisions/${baseline}`, { signal: controller.signal }),
      api<{ investigation: Investigation }>(`/api/investigations/${id}/revisions/${revision}`, { signal: controller.signal }),
    ]).then(([before, after]) => {
      if (!controller.signal.aborted) setRecords({ before: before?.investigation ?? null, after: after.investigation });
    }).catch(caught => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'Saved revisions unavailable'); });
    return () => controller.abort();
  }, [id, expanded, baseline, revision, retry]);
  const changes = records ? compareRevisions(records.before, records.after) : [];
  return <section className="investigation-history"><h3>Save history</h3>
    <ol>{history.map(event => <li key={event.revision}>Revision {event.revision}: {event.action} <time dateTime={event.at}>{new Date(event.at).toLocaleString()}</time></li>)}</ol>
    <details className="revision-inspector" onToggle={event => setExpanded(event.currentTarget.open)}>
      <summary>Compare saved revisions</summary>
      <div className="revision-controls">
        <label>Before revision<select value={baseline} onChange={event => setBaseline(Number(event.target.value))}><option value={-1}>Before creation</option>{history.map(event => <option key={event.revision} value={event.revision}>Revision {event.revision}</option>)}</select></label>
        <label>After revision<select value={revision} onChange={event => setRevision(Number(event.target.value))}>{history.map(event => <option key={event.revision} value={event.revision}>Revision {event.revision}</option>)}</select></label>
      </div>
      <p className="muted">Read-only saved records. Unsaved edits are excluded.</p>
      {error ? <div role="alert">{error}<button title="Retry loading revisions" aria-label="Retry loading revisions" onClick={() => setRetry(previous => previous + 1)}><RotateCcw size={16} /></button></div> : !records ? <p aria-live="polite">Loading saved revisions</p> : <>
        <p>{changes.length} changed fields or records</p>
        <div className="revision-changes" aria-label="Revision changes">{changes.map(change => <section key={change.path}>
          <h4>{change.path}</h4><div className="revision-values"><div><strong>Before</strong><pre>{display(change.before)}</pre></div><div><strong>After</strong><pre>{display(change.after)}</pre></div></div>
        </section>)}</div>
        <details><summary>Full recorded revision {records.after.revision}</summary><pre className="revision-record">{JSON.stringify(records.after, null, 2)}</pre></details>
      </>}
    </details>
  </section>;
}