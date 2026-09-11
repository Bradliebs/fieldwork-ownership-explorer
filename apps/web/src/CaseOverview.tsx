import { useEffect, useState } from 'react';
import { ArrowLeft, FolderOpen, RotateCcw } from 'lucide-react';
import type { CaseOversight } from '../../../packages/contracts/src/oversight.ts';
import { api } from './api.ts';

export function CaseOverview({ onOpen, onClose, busy }: { onOpen: (id: string) => void; onClose: () => void; busy: boolean }) {
  const [data, setData] = useState<{ cases: CaseOversight[]; evaluatedOn: string } | null>(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [filter, setFilter] = useState('attention');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setError(''); setData(null);
    api<{ cases: CaseOversight[]; evaluatedOn: string }>('/api/oversight', { signal: controller.signal }).then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(caught => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'Case overview unavailable'); });
    return () => controller.abort();
  }, [reload]);
  const cases = (data?.cases ?? []).filter(item => {
    if (![item.name, ...item.parcelIds].join(' ').toLowerCase().includes(search.trim().toLowerCase())) return false;
    if (filter === 'attention') return item.needsAttention;
    if (filter === 'awaiting') return item.unresolved.some(request => request.state === 'awaiting response');
    if (filter === 'expired') return item.unresolved.some(request => request.state === 'expired');
    if (filter === 'expiring') return item.expiring.length > 0;
    if (filter === 'retention') return item.retention.state === 'due';
    if (filter === 'archived') return item.state === 'archived';
    if (filter === 'hold') return item.legalHold;
    if (filter === 'missing') return item.retention.state === 'not recorded' || item.missingValidityDates > 0 || item.requestCount === 0;
    return true;
  });
  return <section className="case-overview" aria-label="Case oversight">
    <header><div><h2>Case oversight</h2>{data && <p>Saved records evaluated {data.evaluatedOn}</p>}</div><button type="button" onClick={onClose}><ArrowLeft size={16} />Back to investigations</button><button type="button" title="Refresh oversight" aria-label="Refresh oversight" onClick={() => setReload(previous => previous + 1)}><RotateCcw size={16} /></button></header>
    <div className="oversight-filters"><label>Search cases<input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label><label>Review filter<select value={filter} onChange={event => setFilter(event.target.value)}>
      <option value="attention">Needs attention</option><option value="all">All cases</option><option value="awaiting">Awaiting response</option><option value="expired">Expired grants</option><option value="expiring">Grants expiring within 30 days</option><option value="retention">Retention review due</option><option value="missing">Missing dates or requests</option>
      <option value="archived">Archived cases</option><option value="hold">Legal holds</option>
    </select></label></div>
    <p className="case-caution">Recorded information only. Missing records and other rights-holder approvals may remain. Retention dates trigger review, not automatic deletion.</p>
    {error ? <p role="alert">{error}</p> : !data ? <p aria-live="polite">Loading case oversight</p> : <>
      <p className="muted">{cases.length} of {data.cases.length} saved cases</p>
      <ul className="oversight-cases">{cases.map(item => <li key={item.id}>
        <div className="oversight-case-heading"><h3>{item.name}</h3><button type="button" disabled={busy} title={`Open ${item.name}`} aria-label={`Open oversight case ${item.name}`} onClick={() => onOpen(item.id)}><FolderOpen size={18} /></button></div>
        <p className="mono">Revision {item.revision} / {item.parcelIds.length} parcel{item.parcelIds.length === 1 ? '' : 's'}</p>
        <p>{item.state === 'archived' ? 'Archived' : 'Active'}{item.legalHold ? ' / Legal hold' : ''}</p>
        <div className="oversight-facts"><span>{item.gapCount} record gaps</span><span>{item.requestCount ? `${item.requestCount} requests / ${item.unresolved.length} unresolved` : 'No requests recorded'}</span><span>Retention: {item.retention.state}{item.retention.reviewOn ? ` / ${item.retention.reviewOn}` : ''}</span></div>
        {!!item.missingValidityDates && <p>{item.missingValidityDates} requests have missing validity dates</p>}
        {!!item.expiring.length && <p>{item.expiring.length} recorded grants expire within 30 days</p>}
        {!!(item.unresolved.length + item.expiring.length) && <details><summary>Request review dates</summary><ul>{[...item.unresolved, ...item.expiring].map(request => <li key={request.id}>{request.partyName}: {request.state} / {request.validFrom || 'start not recorded'} to {request.validUntil || 'end not recorded'}</li>)}</ul></details>}
      </li>)}</ul>
      {!cases.length && <p>No saved cases match this filter.</p>}
    </>}
  </section>;
}