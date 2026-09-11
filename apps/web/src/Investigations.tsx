import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowLeft, ClipboardList, FileText, FolderOpen, Printer, RotateCcw, Save, Trash2 } from 'lucide-react';
import type { Investigation, InvestigationEdit, InvestigationEvent, InvestigationSummary, RecoveryDraft } from '../../../packages/contracts/src/investigation.ts';
import type { Parcel, PilotManifest } from '../../../packages/contracts/src/ownership.ts';
import { OwnershipMap } from './OwnershipMap.tsx';
import { SalesEvidence } from './SalesEvidence.tsx';
import { api } from './api.ts';
import type { SalesRelease } from '../../../packages/contracts/src/sales.ts';
import { emptyWorkflow } from '../../../packages/contracts/src/consent.ts';
import { ConsentEditor } from './ConsentEditor.tsx';
import { RevisionHistory } from './RevisionHistory.tsx';
import { CaseOverview } from './CaseOverview.tsx';

export interface InvestigationDraft { parcel: Parcel; parcels?: Parcel[]; manifest: PilotManifest; sales?: SalesRelease }
interface SavedResponse { investigation: Investigation; history: InvestigationEvent[] }

export function Investigations({ draft, token, onDirtyChange, onExplore }: {
  draft: InvestigationDraft | null; token: string; onDirtyChange: (dirty: boolean) => void; onExplore: () => void;
}) {
  const [items, setItems] = useState<InvestigationSummary[]>([]);
  const [overview, setOverview] = useState(false);
  const [gisFormat, setGisFormat] = useState('gpkg');
  const [saved, setSaved] = useState<Investigation | null>(null);
  const [history, setHistory] = useState<InvestigationEvent[]>([]);
  const [creating, setCreating] = useState(Boolean(draft));
  const [source, setSource] = useState(draft);
  const [operationId, setOperationId] = useState<string>(() => crypto.randomUUID());
  const [recoveries, setRecoveries] = useState<RecoveryDraft[]>([]);
  const [recovered, setRecovered] = useState(false);
  const [checkpoint, setCheckpoint] = useState('');
  const [recoveryError, setRecoveryError] = useState('');
  const recoveryId = useRef<string>(crypto.randomUUID());
  const sequence = useRef(0);
  const queue = useRef(Promise.resolve());
  const [edit, setEdit] = useState<InvestigationEdit>({ name: draft ? `Investigation ${draft.parcel.source?.inspireId}` : '', question: '', notes: '', workflow: emptyWorkflow() });
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const errorRef = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState('');
  const dirty = creating || recovered || Boolean(saved && (edit.name !== saved.name || edit.question !== saved.question || edit.notes !== saved.notes || JSON.stringify(edit.workflow) !== JSON.stringify(saved.workflow)));
  const parcel = creating ? source?.parcel : saved?.snapshot.parcel;
  const manifest = creating ? source?.manifest : saved?.snapshot.manifest;
  const caseParcels = (creating ? source?.parcels : saved?.snapshot.parcels) ?? (parcel ? [parcel] : []);
  const checkpointBody = dirty && parcel && manifest ? JSON.stringify({ operationId, investigationId: creating ? null : saved?.id,
    baseRevision: creating ? null : saved?.revision, parcelId: parcel.id, parcelIds: caseParcels.length > 1 ? caseParcels.map(item => item.id) : undefined, published: manifest.published, edit }) : '';
  const latestCheckpoint = useRef(checkpointBody);
  latestCheckpoint.current = checkpointBody;
  useEffect(() => {
    let active = true;
    api<{ drafts: RecoveryDraft[] }>('/api/recovery-drafts').then(data => { if (active) setRecoveries(data.drafts); })
      .catch(() => { if (active) setRecoveryError('Recovery drafts could not be loaded.'); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!checkpointBody || !token) { setCheckpoint(''); return; }
    setCheckpoint('Latest changes not checkpointed');
    const id = recoveryId.current;
    const timer = window.setTimeout(() => {
      const body = JSON.stringify({ ...JSON.parse(checkpointBody), sequence: ++sequence.current });
      queue.current = queue.current.then(async () => {
        try {
          const data = await api<{ draft: RecoveryDraft }>(`/api/recovery-drafts/${id}`, { method: 'PUT', retry: 'never',
            headers: { 'Content-Type': 'application/json', 'x-local-token': token }, body, signal: AbortSignal.timeout(10_000) });
          setRecoveries(previous => [data.draft, ...previous.filter(item => item.id !== id)]);
          if (recoveryId.current === id && latestCheckpoint.current === checkpointBody) setCheckpoint('Draft checkpoint saved locally');
        } catch {
          if (recoveryId.current === id) setCheckpoint('Draft checkpoint failed. Keep this window open and save your investigation.');
        }
      });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [checkpointBody, token]);
  useEffect(() => {
    const controller = new AbortController();
    api<{ investigations: InvestigationSummary[] }>('/api/investigations', { signal: controller.signal })
      .then(data => setItems(data.investigations))
      .catch(caught => { if (!controller.signal.aborted) setError(caught.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);
  useEffect(() => { onDirtyChange(dirty || busy); }, [dirty, busy, onDirtyChange]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => {
    if (!dirty && !busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, busy]);

  function accept(data: SavedResponse) {
    const previousId = recoveryId.current;
    recoveryId.current = crypto.randomUUID();
    setRecovered(false); setCheckpoint('');
    queue.current = queue.current.then(() => closeRecovery(previousId)).catch(() => setRecoveryError('Saved case opened, but its recovery draft could not be cleared.'));
    setSaved(data.investigation); setHistory(data.history); setCreating(false);
    setEdit({ name: data.investigation.name, question: data.investigation.question, notes: data.investigation.notes, workflow: data.investigation.workflow });
  }
  async function closeRecovery(id: string) {
    await api(`/api/recovery-drafts/${id}`, { method: 'DELETE', retry: 'idempotent', headers: { 'x-local-token': token }, signal: AbortSignal.timeout(10_000) });
    setRecoveries(previous => previous.filter(item => item.id !== id));
  }
  async function restoreRecovery(item: RecoveryDraft) {
    if (dirty && !window.confirm('Replace the current editor with this recovery draft? Existing checkpoints will remain available.')) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const current = item.investigationId ? await api<SavedResponse>(`/api/investigations/${item.investigationId}`) : null;
      recoveryId.current = item.id; sequence.current = item.sequence;
      setSource({ parcel: item.snapshot.parcel, parcels: item.snapshot.parcels, manifest: item.snapshot.manifest, sales: item.snapshot.sales });
      setOperationId(item.operationId); setCreating(!current); setRecovered(true);
      setSaved(current ? { ...current.investigation, revision: item.baseRevision! } : null);
      setHistory(current?.history ?? []); setEdit(item.edit);
      setMessage(current && current.investigation.revision !== item.baseRevision
        ? 'Draft recovered from an older revision. Preserve your edits before reopening the saved version.' : 'Draft recovered. Not saved as a case revision.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to recover draft'); }
    finally { setBusy(false); }
  }
  async function discardRecovery(item: RecoveryDraft) {
    if (!window.confirm('Discard this recovery draft? Saved case revisions are unchanged.')) return;
    setBusy(true); setRecoveryError('');
    try { await closeRecovery(item.id); }
    catch { setRecoveryError('Recovery draft could not be discarded.'); }
    finally { setBusy(false); }
  }
  async function open(id: string) {
    if (dirty && !window.confirm('Discard unsaved investigation changes?')) return;
    setBusy(true); setError(''); setMessage('');
    try { accept(await api<SavedResponse>(`/api/investigations/${id}`)); setOverview(false); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to open investigation'); }
    finally { setBusy(false); }
  }
  async function save() {
    if (!parcel || !manifest) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const data = await api<SavedResponse>(saved && !creating ? `/api/investigations/${saved.id}` : '/api/investigations', {
        method: saved && !creating ? 'PUT' : 'POST',
        retry: saved && !creating ? 'never' : 'operation-id',
        headers: { 'Content-Type': 'application/json', 'x-local-token': token },
        body: JSON.stringify(saved && !creating ? { ...edit, revision: saved.revision } : { ...edit, parcelId: parcel.id, parcelIds: caseParcels.length > 1 ? caseParcels.map(item => item.id) : undefined, published: manifest.published, operationId }),
      });
      accept(data);
      const item = data.investigation;
      setItems(previous => [{ id: item.id, name: item.name, parcelId: item.snapshot.parcel.id, revision: item.revision, updatedAt: item.updatedAt }, ...previous.filter(entry => entry.id !== item.id)]);
      setMessage(`Investigation saved. Revision ${item.revision}.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to save investigation'); }
    finally { setBusy(false); }
  }
  async function upload(file: File) {
    if (!saved || dirty || busy) return;
    if (!file.size || file.size > 3_000_000) { setError('Document must be between 1 byte and 3 MB.'); return; }
    setBusy(true); setError(''); setMessage('');
    try {
      const bytes = await file.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const sha256 = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
      const duplicate = saved.documents.find(document => document.sha256 === sha256);
      if (duplicate && !window.confirm(`Identical content is already attached as ${duplicate.name}. Retain another copy with a separate audit entry?`)) return;
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error('Unable to read document')); reader.readAsDataURL(file);
      });
      const mediaType = file.type || ({ pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', txt: 'text/plain' } as Record<string, string>)[file.name.split('.').pop()!.toLowerCase()];
      const data = await api<SavedResponse>(`/api/investigations/${saved.id}/documents`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-local-token': token }, body: JSON.stringify({ revision: saved.revision, name: file.name, mediaType, base64, allowDuplicate: Boolean(duplicate) }) });
      accept(data); setItems(previous => previous.map(item => item.id === saved.id ? { ...item, revision: data.investigation.revision, updatedAt: data.investigation.updatedAt } : item));
      setMessage(`Document saved. Revision ${data.investigation.revision}.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Document upload failed'); }
    finally { setBusy(false); }
  }
  async function requestDraft(id: string) {
    if (!saved || dirty) return;
    setError('');
    const url = `/api/investigations/${saved.id}/requests/${id}`;
    const windowRef = window.open('about:blank', '_blank');
    if (windowRef) windowRef.opener = null;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error((await response.json()).error);
      if (windowRef) windowRef.location.href = url;
      else throw new Error('The browser blocked the request window. Allow popups and try again.');
    } catch (caught) { windowRef?.close(); setError(caught instanceof Error ? caught.message : 'Request draft unavailable'); }
  }
  return <main className="investigations-view">
    <aside className="investigation-list" aria-label="Saved investigations">
      <div className="investigation-list-heading"><FolderOpen size={22} /><h1>Investigations</h1></div>
      <button onClick={onExplore} disabled={busy}><ArrowLeft size={16} />Explore parcels</button>
      <button type="button" onClick={() => setOverview(true)} disabled={busy}><ClipboardList size={16} />Case oversight</button>
      {loading ? <p role="status">Loading investigations</p> : !items.length ? <p className="muted">No saved investigations</p> :
        <ul>{items.map(item => <li key={item.id}><button className={saved?.id === item.id && !creating ? 'active' : ''} aria-current={saved?.id === item.id && !creating ? 'true' : undefined} disabled={busy} onClick={() => void open(item.id)}>
          <strong>{item.name}</strong><span className="mono">{item.parcelId}</span><span>Revision {item.revision} / {new Date(item.updatedAt).toLocaleDateString()}</span>
        </button></li>)}</ul>}
      {recoveries.some(item => item.id !== recoveryId.current) && <section aria-label="Recovery drafts"><h2>Recovery drafts</h2><ul>
        {recoveries.filter(item => item.id !== recoveryId.current).map(item => <li key={item.id}>
          <button disabled={busy} onClick={() => void restoreRecovery(item)} aria-label={`Restore draft ${item.edit.name || 'Untitled investigation'}`}><RotateCcw size={16} /><strong>{item.edit.name || 'Untitled investigation'}</strong><span>{new Date(item.updatedAt).toLocaleString()}</span></button>
          <button disabled={busy} title="Discard recovery draft" aria-label={`Discard draft ${item.edit.name || 'Untitled investigation'}`} onClick={() => void discardRecovery(item)}><Trash2 size={16} /></button>
        </li>)}
      </ul></section>}
    </aside>
    <article className="investigation-editor">
      {error && <div className="investigation-error" role="alert" tabIndex={-1} ref={errorRef}>{error}</div>}
      {recoveryError && <p role="alert">{recoveryError}</p>}
      {checkpoint && <p className="checkpoint-status" aria-live="polite">{checkpoint}</p>}
      {message && <p className="success-message" role="status">{message}</p>}
      {overview ? <CaseOverview onOpen={id => void open(id)} onClose={() => setOverview(false)} busy={busy} /> : !parcel || !manifest ? <div className="investigation-empty"><FileText size={32} /><h2>No investigation open</h2><button onClick={onExplore}><ArrowLeft size={16} />Explore parcels</button></div> : <>
        <header className="investigation-heading"><div><span className="section-eyebrow">{creating ? 'NEW INVESTIGATION' : `SAVED REVISION ${saved?.revision}`}</span><h2>{parcel.id}</h2><p>{manifest.name} / {manifest.published}</p></div>
          <button disabled={!saved || dirty || busy} title={dirty ? 'Save changes before opening the report' : 'Open saved report'} onClick={() => window.open(`/api/investigations/${saved!.id}/report`, '_blank', 'noopener,noreferrer')}><Printer size={16} />Report</button>
        </header>
        <div className="investigation-map"><OwnershipMap key={saved?.id ?? parcel.id} parcels={caseParcels} allParcels={caseParcels} pilot={false} selected={parcel.id} onSelect={() => {}} snapshot /></div>
        {caseParcels.length > 1 && <section aria-label="Case parcels"><h3>{caseParcels.length} case parcels</h3><ul>{caseParcels.map(item => <li key={item.id}>{item.id}: ownership not established</li>)}</ul></section>}
        <div className="investigation-facts"><span>INSPIRE ownership: <strong>Not established</strong></span><span>Case title checks: <strong>{edit.workflow?.titles.filter(title => title.verification === 'checked').length ?? 0}</strong></span></div>
        <div className="gis-export"><label>GIS format<select value={gisFormat} onChange={event => setGisFormat(event.target.value)}><option value="gpkg">GeoPackage</option><option value="geojson">GeoJSON</option></select></label><button type="button" disabled={!saved || dirty || busy} title="Download saved case GIS" aria-label="Download saved case GIS" onClick={() => { window.location.href = `/api/investigations/${saved!.id}/gis?revision=${saved!.revision}&format=${gisFormat}`; }}><ArrowDownToLine size={16} /></button><span>Saved parcel scope and provenance; contacts and notes excluded.</span></div>
        <details className="case-sales"><summary>Recorded sales (property context only, not contact data)</summary><SalesEvidence sales={creating ? source?.sales : saved?.snapshot.sales} /></details>
        <form className="investigation-form" onSubmit={event => { event.preventDefault(); void save(); }}>
          <label>Investigation name<input required maxLength={160} value={edit.name} disabled={busy || saved?.workflow.lifecycle?.state === 'archived'} onChange={event => setEdit({ ...edit, name: event.target.value })} /></label>
          <label>Investigation question<textarea rows={2} maxLength={2000} value={edit.question} disabled={busy || saved?.workflow.lifecycle?.state === 'archived'} onChange={event => setEdit({ ...edit, question: event.target.value })} /></label>
          <label>Analyst notes<textarea rows={6} maxLength={8000} value={edit.notes} disabled={busy || saved?.workflow.lifecycle?.state === 'archived'} onChange={event => setEdit({ ...edit, notes: event.target.value })} /></label>
          <ConsentEditor value={edit.workflow ?? emptyWorkflow()} onChange={workflow => setEdit({ ...edit, workflow })} disabled={busy} archived={saved?.workflow.lifecycle?.state === 'archived'} savedId={saved?.id} savedReady={Boolean(saved && !dirty && !busy)} documents={saved?.documents ?? []} parcelIds={caseParcels.map(item => item.id)} onUpload={file => void upload(file)} onRequest={id => void requestDraft(id)} />
          <div className="investigation-actions"><button className="primary" type="submit" disabled={busy || !edit.name.trim() || !dirty || !token}><Save size={16} />{busy ? 'Saving' : 'Save investigation'}</button><span>{dirty ? 'Unsaved changes' : 'All changes saved'}</span>
            {saved && <button type="button" disabled={busy} onClick={() => void open(saved.id)}>Reopen saved version</button>}
          </div>
        </form>
        {saved && !!history.length && <RevisionHistory key={`${saved.id}:${saved.revision}`} id={saved.id} history={history} />}
        <footer className="investigation-provenance"><p>{manifest.attribution}</p><p>Indicative extent, not a legal title boundary. Analyst notes are not verified ownership evidence.</p>{saved && <p className="mono">Source SHA-256: {saved.snapshot.releaseSha256}</p>}</footer>
      </>}
    </article>
  </main>;
}