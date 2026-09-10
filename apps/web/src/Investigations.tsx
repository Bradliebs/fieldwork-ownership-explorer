import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, FileText, FolderOpen, Printer, Save } from 'lucide-react';
import type { Investigation, InvestigationEdit, InvestigationEvent, InvestigationSummary } from '../../../packages/contracts/src/investigation.ts';
import type { Parcel, PilotManifest } from '../../../packages/contracts/src/ownership.ts';
import { OwnershipMap } from './OwnershipMap.tsx';
import { SalesEvidence } from './SalesEvidence.tsx';
import { api } from './api.ts';
import type { SalesRelease } from '../../../packages/contracts/src/sales.ts';
import { emptyWorkflow } from '../../../packages/contracts/src/consent.ts';
import { ConsentEditor } from './ConsentEditor.tsx';

export interface InvestigationDraft { parcel: Parcel; manifest: PilotManifest; sales?: SalesRelease }
interface SavedResponse { investigation: Investigation; history: InvestigationEvent[] }

export function Investigations({ draft, token, onDirtyChange, onExplore }: {
  draft: InvestigationDraft | null; token: string; onDirtyChange: (dirty: boolean) => void; onExplore: () => void;
}) {
  const [items, setItems] = useState<InvestigationSummary[]>([]);
  const [saved, setSaved] = useState<Investigation | null>(null);
  const [history, setHistory] = useState<InvestigationEvent[]>([]);
  const [creating, setCreating] = useState(Boolean(draft));
  const [operationId] = useState(() => crypto.randomUUID());
  const [edit, setEdit] = useState<InvestigationEdit>({ name: draft ? `Investigation ${draft.parcel.source?.inspireId}` : '', question: '', notes: '', workflow: emptyWorkflow() });
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const errorRef = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState('');
  const dirty = creating || Boolean(saved && (edit.name !== saved.name || edit.question !== saved.question || edit.notes !== saved.notes || JSON.stringify(edit.workflow) !== JSON.stringify(saved.workflow)));
  const parcel = creating ? draft?.parcel : saved?.snapshot.parcel;
  const manifest = creating ? draft?.manifest : saved?.snapshot.manifest;
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
    setSaved(data.investigation); setHistory(data.history); setCreating(false);
    setEdit({ name: data.investigation.name, question: data.investigation.question, notes: data.investigation.notes, workflow: data.investigation.workflow });
  }
  async function open(id: string) {
    if (dirty && !window.confirm('Discard unsaved investigation changes?')) return;
    setBusy(true); setError(''); setMessage('');
    try { accept(await api<SavedResponse>(`/api/investigations/${id}`)); }
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
        body: JSON.stringify(saved && !creating ? { ...edit, revision: saved.revision } : { ...edit, parcelId: parcel.id, published: manifest.published, operationId }),
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
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error('Unable to read document')); reader.readAsDataURL(file);
      });
      const mediaType = file.type || ({ pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', txt: 'text/plain' } as Record<string, string>)[file.name.split('.').pop()!.toLowerCase()];
      const data = await api<SavedResponse>(`/api/investigations/${saved.id}/documents`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-local-token': token }, body: JSON.stringify({ revision: saved.revision, name: file.name, mediaType, base64 }) });
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
      {loading ? <p role="status">Loading investigations</p> : !items.length ? <p className="muted">No saved investigations</p> :
        <ul>{items.map(item => <li key={item.id}><button className={saved?.id === item.id && !creating ? 'active' : ''} aria-current={saved?.id === item.id && !creating ? 'true' : undefined} disabled={busy} onClick={() => void open(item.id)}>
          <strong>{item.name}</strong><span className="mono">{item.parcelId}</span><span>Revision {item.revision} / {new Date(item.updatedAt).toLocaleDateString()}</span>
        </button></li>)}</ul>}
    </aside>
    <article className="investigation-editor">
      {error && <div className="investigation-error" role="alert" tabIndex={-1} ref={errorRef}>{error}</div>}
      {message && <p className="success-message" role="status">{message}</p>}
      {!parcel || !manifest ? <div className="investigation-empty"><FileText size={32} /><h2>No investigation open</h2><button onClick={onExplore}><ArrowLeft size={16} />Explore parcels</button></div> : <>
        <header className="investigation-heading"><div><span className="section-eyebrow">{creating ? 'NEW INVESTIGATION' : `SAVED REVISION ${saved?.revision}`}</span><h2>{parcel.id}</h2><p>{manifest.name} / {manifest.published}</p></div>
          <button disabled={!saved || dirty || busy} title={dirty ? 'Save changes before opening the report' : 'Open saved report'} onClick={() => window.open(`/api/investigations/${saved!.id}/report`, '_blank', 'noopener,noreferrer')}><Printer size={16} />Report</button>
        </header>
        <div className="investigation-map"><OwnershipMap key={saved?.id ?? parcel.id} parcels={[parcel]} allParcels={[parcel]} pilot={false} selected={parcel.id} onSelect={() => {}} snapshot /></div>
        <div className="investigation-facts"><span>INSPIRE ownership: <strong>Not established</strong></span><span>Case title checks: <strong>{edit.workflow?.titles.filter(title => title.verification === 'checked').length ?? 0}</strong></span></div>
        <details className="case-sales"><summary>Recorded sales (property context only, not contact data)</summary><SalesEvidence sales={creating ? draft?.sales : saved?.snapshot.sales} /></details>
        <form className="investigation-form" onSubmit={event => { event.preventDefault(); void save(); }}>
          <label>Investigation name<input required maxLength={160} value={edit.name} disabled={busy} onChange={event => setEdit({ ...edit, name: event.target.value })} /></label>
          <label>Investigation question<textarea rows={2} maxLength={2000} value={edit.question} disabled={busy} onChange={event => setEdit({ ...edit, question: event.target.value })} /></label>
          <label>Analyst notes<textarea rows={6} maxLength={8000} value={edit.notes} disabled={busy} onChange={event => setEdit({ ...edit, notes: event.target.value })} /></label>
          <ConsentEditor value={edit.workflow ?? emptyWorkflow()} onChange={workflow => setEdit({ ...edit, workflow })} disabled={busy} savedId={saved?.id} savedReady={Boolean(saved && !dirty && !busy)} documents={saved?.documents ?? []} onUpload={file => void upload(file)} onRequest={id => void requestDraft(id)} />
          <div className="investigation-actions"><button className="primary" type="submit" disabled={busy || !edit.name.trim() || !dirty || !token}><Save size={16} />{busy ? 'Saving' : 'Save investigation'}</button><span>{dirty ? 'Unsaved changes' : 'All changes saved'}</span>
            {saved && <button type="button" disabled={busy} onClick={() => void open(saved.id)}>Reopen saved version</button>}
          </div>
        </form>
        {!!history.length && <section className="investigation-history"><h3>Save history</h3><ol>{history.map(event => <li key={event.revision}>Revision {event.revision}: {event.action} <time dateTime={event.at}>{new Date(event.at).toLocaleString()}</time></li>)}</ol></section>}
        <footer className="investigation-provenance"><p>{manifest.attribution}</p><p>Indicative extent, not a legal title boundary. Analyst notes are not verified ownership evidence.</p>{saved && <p className="mono">Source SHA-256: {saved.snapshot.releaseSha256}</p>}</footer>
      </>}
    </article>
  </main>;
}