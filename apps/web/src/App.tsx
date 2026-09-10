import { useDeferredValue, useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowLeft, ArrowUpRight, Check, ChevronRight, Database, FileText, FolderOpen, Layers, Map, Search, ShieldCheck, X } from 'lucide-react';
import { OwnershipMap } from './OwnershipMap.tsx';
import { Investigations, type InvestigationDraft } from './Investigations.tsx';
import { SalesEvidence } from './SalesEvidence.tsx';
import { api } from './api.ts';
import { salesForParcel, type SalesRelease } from '../../../packages/contracts/src/sales.ts';
import { parcelStatus, type Parcel, type PilotManifest, type ReviewStatus } from '../../../packages/contracts/src/ownership.ts';

export function App() {
  const [dataset, setDataset] = useState<'pilot' | 'demo'>('pilot');
  const [manifest, setManifest] = useState<PilotManifest | null>(null);
  const [resultLimit, setResultLimit] = useState(100);
  const [parcels, setParcels] = useState<Parcel[]>([]);
  const [sales, setSales] = useState<SalesRelease>();
  const [salesOnly, setSalesOnly] = useState(false);
  const [token, setToken] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [filter, setFilter] = useState('all');
  const [interest, setInterest] = useState('all');
  const [view, setView] = useState<'map' | 'review' | 'sources' | 'investigations'>('map');
  const [investigationDraft, setInvestigationDraft] = useState<InvestigationDraft | null>(null);
  const [investigationDirty, setInvestigationDirty] = useState(false);
  function navigate(next: typeof view) {
    if (next === view) return;
    if (investigationDirty && !window.confirm('Discard unsaved investigation changes?')) return;
    setInvestigationDirty(false); setInvestigationDraft(null); setView(next);
  }
  const [error, setError] = useState('');
  const errorRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reviewer, setReviewer] = useState('');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [gates, setGates] = useState<string[]>([]);
  async function load(signal?: AbortSignal) {
    setLoading(true); setError('');
    try {
      const [session, data, status, saleData] = await Promise.all([
        api<{ token: string }>('/api/session', { signal }), api<{ parcels: Parcel[]; manifest?: PilotManifest }>(dataset === 'pilot' ? '/api/pilot-parcels' : '/api/parcels', { signal }), api<{ gates: string[] }>('/api/status', { signal }),
        dataset === 'pilot' ? api<{ sales: SalesRelease | null }>('/api/pilot-sales', { signal }) : Promise.resolve({ sales: null }),
      ]);
      if (signal?.aborted) return;
      setToken(session.token); setParcels(data.parcels); setManifest(data.manifest ?? null); setGates(status.gates);
      setSales(saleData.sales ?? undefined);
    } catch (caught) { if (!signal?.aborted) setError(caught instanceof Error ? caught.message : 'Unable to load records'); }
    finally { if (!signal?.aborted) setLoading(false); }
  }
  useEffect(() => {
    const controller = new AbortController();
    setSales(undefined); setSalesOnly(false);
    setParcels([]); setManifest(null); setSelected(null); setQuery(''); setFilter('all'); setInterest('all'); setReason(''); setMessage(''); setResultLimit(100);
    void load(controller.signal);
    return () => controller.abort();
  }, [dataset]);
  useEffect(() => { setResultLimit(100); }, [deferredQuery, filter, interest, view, salesOnly]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  const visible = parcels.filter(parcel => {
    const haystack = [parcel.id, parcel.label, ...parcel.links.flatMap(link => [link.titleNumber ?? '', ...link.proprietors])].join(' ').toLowerCase();
    return haystack.includes(deferredQuery.trim().toLowerCase()) &&
      (!salesOnly || sales?.records.some(record => record.inspireIds.includes(parcel.source?.inspireId ?? ''))) &&
      (filter === 'all' || parcelStatus(parcel) === filter) &&
      (interest === 'all' || (parcel.source && interest === 'freehold') || parcel.links.some(link => link.interest === interest)) &&
      (view !== 'review' || parcel.links.some(link => link.review === 'pending'));
  });
  const current = parcels.find(parcel => parcel.id === selected);
  const pending = parcels.filter(parcel => parcel.links.some(link => link.review === 'pending')).length;
  function select(id: string) { setSelected(id); setReason(''); setMessage(''); }
  async function review(linkId: string, decision: ReviewStatus) {
    if (!current) return;
    setSaving(true); setError(''); setMessage('');
    try {
      const saved = await api<{ parcel: Parcel }>('/api/reviews', { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-local-token': token },
        body: JSON.stringify({ parcelId: current.id, linkId, revision: current.revision, review: decision, reviewer, reason }),
      });
      setParcels(items => items.map(parcel => parcel.id === saved.parcel.id ? saved.parcel : parcel));
      setReason(''); setMessage('Review saved. Ownership evidence is unchanged.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Review failed'); }
    finally { setSaving(false); }
  }
  async function exportRecords(ids: string[]) {
    setError('');
    try {
      const data = dataset === 'pilot' ? { type: 'FeatureCollection', synthetic: false, manifest,
        notice: 'Indicative freehold polygons, not legal boundaries. Ownership not established. Web display coordinates only.',
        features: parcels.filter(parcel => ids.includes(parcel.id)).map(parcel => ({ type: 'Feature', id: parcel.id, geometry: parcel.geometry,
          properties: { id: parcel.id, source: parcel.source, status: parcelStatus(parcel), links: parcel.links, saleEvidence: salesForParcel(sales, parcel.source?.inspireId ?? '') } })),
      } : await api<unknown>(`/api/export?ids=${encodeURIComponent(ids.join(','))}`);
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/geo+json' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = dataset === 'pilot' ? 'bristol-inspire.geojson' : 'synthetic-ownership.geojson'; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Export failed'); }
  }
  return <div className="app">
    <header className="topbar">
      <div className="brand"><span className="brand-mark"><Layers size={23} /></span><div>Fieldwork<small>OWNERSHIP EXPLORER</small></div></div>
      <nav aria-label="Main navigation">
        <button className={view === 'map' ? 'active' : ''} onClick={() => navigate('map')}><Map size={17} />Explore</button>
        <button className={view === 'investigations' ? 'active' : ''} onClick={() => navigate('investigations')}><FolderOpen size={17} />Investigations</button>
        <button className={view === 'review' ? 'active' : ''} onClick={() => navigate('review')}><ShieldCheck size={17} />Review<span className="count">{pending}</span></button>
        <button className={view === 'sources' ? 'active' : ''} onClick={() => navigate('sources')}><Database size={17} />Data</button>
      </nav>
      <select className="dataset-select" aria-label="Workspace dataset" value={view === 'investigations' ? 'pilot' : dataset} disabled={view === 'investigations'} onChange={event => { setDataset(event.target.value as 'pilot' | 'demo'); setView('map'); }}><option value="pilot">Bristol / INSPIRE</option><option value="demo">Synthetic review demo</option></select>
    </header>
    <div className="demo-banner"><span>{view === 'investigations' ? <><strong>Local investigations</strong> Saved Bristol parcel snapshots. Ownership not established. Not legal title extents.</> : dataset === 'pilot' ? <><strong>Bristol pilot extract</strong> Indicative freehold boundaries. Ownership not established. Not legal title extents.</> : <><strong>Synthetic preview</strong> Fictional parcels, organisations and evidence. No real ownership.</>}</span><span className="mono">{view === 'investigations' ? 'LOCAL STORAGE' : manifest?.published ?? 'BUILD 0.2'}</span></div>
    {error && <div className="error-bar" role="alert" tabIndex={-1} ref={errorRef}>{error}<button onClick={() => void load()}>Reload records</button><button aria-label="Dismiss error" onClick={() => setError('')}><X size={16} /></button></div>}
    {view === 'investigations' ? <Investigations draft={investigationDraft} token={token} onDirtyChange={setInvestigationDirty} onExplore={() => navigate('map')} /> : view === 'sources' ? <main className="sources-view">
      <div className="section-eyebrow">WORKSPACE / DATA</div><h1>Source register</h1><p className="muted">England and Wales <span className="separator">/</span> No national coverage loaded</p>
      <div className="source-summary"><div><strong>{parcels.length}</strong><span>{dataset === 'pilot' ? 'Real polygons' : 'Synthetic parcels'}</span></div><div><strong>{manifest ? 1 : 0}</strong><span>INSPIRE releases</span></div><div><strong>{gates.length}</strong><span>Open setup gates</span></div></div>
      {manifest && <section className="pilot-source"><h2>{manifest.name}</h2><p>INSPIRE published {manifest.published}. OpenStreetMap snapshot {manifest.osm.published}. Neighbourhood extract only.</p><p>{manifest.attribution}</p><p>{manifest.osm.attribution}</p><p>{manifest.transform}</p><a href="/api/pilot-release" target="_blank" rel="noreferrer">Source manifest and checksums</a><span> / </span><a href={manifest.licence} target="_blank" rel="noreferrer">INSPIRE conditions</a><span> / </span><a href={manifest.osm.licence} target="_blank" rel="noreferrer">OpenStreetMap licence</a></section>}
      <h2>Data readiness</h2><div className="gate-list">{gates.map((gate, index) => <div key={gate}><span className="gate-dot" />{dataset === 'pilot' && index === 0 ? 'Corporate ownership licences and imports' : gate}<span>Pending</span></div>)}</div>
      {dataset === 'pilot' && sales && <section><h2>Recorded sales</h2><p>{sales.records.length} transactions linked to the pilot / HMLR publication period {sales.period}. Sale dates may precede the publication period. Ownership remains unknown.</p><p>{sales.attribution}</p><a href={sales.addressConditions} target="_blank" rel="noreferrer">Price Paid Data conditions</a></section>}
      <h2>Planned sources</h2><div className="source-table">{[
        ['INSPIRE', 'Indicative freehold polygons', 'https://use-land-property-data.service.gov.uk/datasets/inspire'],
        ['CCOD', 'UK corporate proprietors', 'https://use-land-property-data.service.gov.uk/datasets/ccod'],
        ['OCOD', 'Overseas corporate proprietors', 'https://use-land-property-data.service.gov.uk/datasets/ocod'],
        ['Public estates', 'Published ownership and management interests', 'https://data-forestry.opendata.arcgis.com/'],
      ].map(([name, description, href]) => <a key={name} href={href} target="_blank" rel="noreferrer"><strong>{name}</strong><span>{description}</span><span>{name === 'INSPIRE' && manifest ? 'Pilot extract' : 'Not loaded'}</span><ArrowUpRight size={16} /></a>)}</div>
      <p className="muted">Local review journal: synthetic data only. GeoPackage delivery remains pending GDAL and ArcGIS Pro validation.</p>
    </main> : <main className={`workspace ${current ? 'has-selection' : ''}`}>
      <aside className="parcel-list">
        <div className="list-heading"><div className="section-eyebrow">{dataset === 'pilot' ? 'BRISTOL / HARBOURSIDE' : 'SYNTHETIC WORKSPACE'}</div><h1>{view === 'review' ? 'Review queue' : 'Land interests'}</h1><p>{view === 'review' ? 'Pending evidence reviews' : dataset === 'pilot' ? 'Registered freehold index polygons' : 'Synthetic pilot workspace'}</p></div>
        <div className="filters"><label className="search"><Search size={17} /><input aria-label="Search parcels" placeholder="Owner, title or parcel ID" value={query} onChange={event => setQuery(event.target.value)} />{query && <button title="Clear search" aria-label="Clear search" onClick={() => setQuery('')}><X size={14} /></button>}</label>
          {dataset === 'pilot' && <label className="sales-filter"><input type="checkbox" checked={salesOnly} disabled={!sales} onChange={event => setSalesOnly(event.target.checked)} />Recorded sales only</label>}
          <div className="filter-row"><label>Match status<select aria-label="Match status" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All statuses</option>{['verified', 'candidate', 'ambiguous', 'unknown'].map(status => <option key={status} value={status}>{status}</option>)}</select></label>
          <label>Interest<select aria-label="Interest" value={interest} onChange={event => setInterest(event.target.value)}><option value="all">All interests</option>{['freehold', 'leasehold', 'managed', 'occupied'].map(value => <option key={value} value={value}>{value}</option>)}</select></label></div>
        </div>
        <div className="results-heading"><span>{loading ? 'Loading records' : `${visible.length} parcels`}</span><button title="Export filtered parcels as GeoJSON" aria-label="Export visible parcels" disabled={!visible.length} onClick={() => void exportRecords(visible.map(parcel => parcel.id))}><ArrowDownToLine size={16} /></button></div>
        <div className="results">{visible.slice(0, resultLimit).map(parcel => <button className={`parcel-row ${selected === parcel.id ? 'selected' : ''}`} key={parcel.id} onClick={() => select(parcel.id)}>
          <div className="row-meta"><span className="mono">{parcel.id}</span><span className={`badge ${parcelStatus(parcel)}`}>{parcelStatus(parcel)}</span></div>
          <strong>{parcel.label}</strong><span className="owner-name">{parcel.links.filter(link => link.review !== 'rejected').flatMap(link => link.proprietors).join(' / ') || 'Ownership unknown'}</span>
          <div className="row-bottom"><span>{parcel.source ? 'Freehold index polygon' : parcel.links[0]?.interest ?? 'No linked interest'}</span><ChevronRight size={14} /></div>
        </button>)}{visible.length > resultLimit && <button className="more-results" onClick={() => setResultLimit(value => value + 100)}>Show more ({resultLimit} of {visible.length})</button>}{!loading && !visible.length && <div className="empty"><Search size={24} /><h2>No matching parcels</h2><button onClick={() => { setQuery(''); setFilter('all'); setInterest('all'); }}>Clear filters</button></div>}</div>
        <footer className="list-footer"><Database size={14} />{dataset === 'pilot' ? 'HMLR INSPIRE' : 'Synthetic fixture release'}<span>{manifest?.published ?? '06 SEP 2026'}</span></footer>
      </aside>
      <OwnershipMap key={dataset} parcels={visible} allParcels={parcels} pilot={dataset === 'pilot'} selected={selected} onSelect={select} />
      {current && <aside className="detail-panel" aria-label="Parcel evidence">
        <div className="detail-top"><span className="section-eyebrow">PARCEL RECORD</span><button aria-label="Close parcel details" title="Close parcel details" onClick={() => setSelected(null)}><X size={19} /></button></div>
        <div className="detail-title"><span className="mono">{current.id}</span><h2>{current.label}</h2><span className={`badge ${parcelStatus(current)}`}>{parcelStatus(current)}</span><span className="fixture-tag">{current.source ? 'INSPIRE' : 'Synthetic'}</span></div>
        <div className="detail-content">{current.source && <section className="geometry-source"><h3>Geometry source</h3><dl><dt>Source</dt><dd>{current.source.name}</dd><dt>INSPIRE ID</dt><dd className="mono">{current.source.inspireId}</dd><dt>Published</dt><dd>{current.source.published}</dd><dt>Tenure coverage</dt><dd>Freehold index</dd></dl><p>Indicative extent, not a legal title boundary. An INSPIRE ID is not a title number.</p><a href={current.source.url} target="_blank" rel="noreferrer">Source and conditions</a></section>}{current.links.length === 0 ? <div className="unknown-panel"><FileText size={26} /><h3>Ownership unknown</h3><p>{current.source ? 'No owner or title-number relationship has been established. This does not imply private ownership or unregistered land.' : 'No ownership relationship is recorded for this fictional parcel.'}</p></div> : current.links.map(link => <section className="interest-record" key={link.id}>
          <h3>Reported interest</h3><dl><dt>Title number</dt><dd className="mono">{link.titleNumber ?? 'Not supplied'}</dd><dt>Interest</dt><dd>{link.interest}</dd><dt>Review</dt><dd>{link.review}</dd></dl>
          <h3>Recorded organisations</h3>{link.proprietors.map(owner => <div className="proprietor" key={owner}><span className="organisation-icon"><Layers size={17} /></span><strong>{owner}</strong></div>)}
          <h3>Evidence trail</h3>{link.evidence.map(evidence => <div className="evidence" key={evidence.id}><div><FileText size={15} /><strong>{evidence.method === 'documentary' ? 'Documentary fixture' : evidence.method === 'overlap' ? 'Spatial overlap candidate' : 'Property-address candidate'}</strong></div><dl><dt>Source</dt><dd>{evidence.source}</dd><dt>Source date</dt><dd>{evidence.sourceDate}</dd><dt>Scope</dt><dd>{evidence.scope} parcel</dd><dt>Reference</dt><dd className="mono">{evidence.reference}</dd></dl></div>)}
          <form className="review-form" onSubmit={event => { event.preventDefault(); void review(link.id, 'reviewed'); }}><h3>Review decision</h3><label>Reviewer<input aria-label="Reviewer" required maxLength={100} value={reviewer} onChange={event => setReviewer(event.target.value)} /></label><label>Evidence notes<textarea aria-label="Evidence notes" required maxLength={2000} rows={3} value={reason} onChange={event => setReason(event.target.value)} /></label><div className="review-actions"><button className="primary" disabled={saving || !reason.trim() || !reviewer.trim()} type="submit"><Check size={15} />{saving ? 'Saving' : 'Mark reviewed'}</button><button type="button" disabled={saving || !reason.trim() || !reviewer.trim()} onClick={() => void review(link.id, 'rejected')}><X size={15} />Reject</button></div>{link.review !== 'pending' && <button type="button" className="reopen" disabled={saving || !reason.trim() || !reviewer.trim()} onClick={() => void review(link.id, 'pending')}><ArrowLeft size={14} />Reopen review</button>}</form>
        </section>)}{message && <p role="status" className="success-message">{message}</p>}</div>
        {dataset === 'pilot' && <div className="parcel-sales"><SalesEvidence sales={salesForParcel(sales, current.source?.inspireId ?? '')} /></div>}
        <div className="detail-footer">{dataset === 'pilot' && manifest && <button onClick={() => { setInvestigationDraft({ parcel: current, manifest, sales: salesForParcel(sales, current.source?.inspireId ?? '') }); setView('investigations'); }}><FolderOpen size={16} />Start investigation</button>}<button onClick={() => void exportRecords([current.id])}><ArrowDownToLine size={16} />{dataset === 'pilot' ? 'Export parcel GeoJSON' : 'Export synthetic GeoJSON'}</button></div>
      </aside>}
    </main>}
  </div>;
}