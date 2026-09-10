import { useEffect, useRef, useState } from 'react';
import { Download, FilePlus2, Plus, Printer, Trash2 } from 'lucide-react';
import { effectiveConsentStatus, type ConsentWorkflow, type EvidenceDocument } from '../../../packages/contracts/src/consent.ts';
import { evaluateEvidenceReadiness, type ReadinessGap } from '../../../packages/contracts/src/readiness.ts';

function Field({ label, value, onChange, multiline = false, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean; type?: string }) {
  return <label>{label}{multiline ? <textarea aria-label={label} rows={3} value={value} maxLength={2000} onChange={event => onChange(event.target.value)} /> : <input aria-label={label} type={type} value={value} maxLength={type === 'email' ? 254 : 200} onChange={event => onChange(event.target.value)} />}</label>;
}
function Choice({ label, value, values, onChange }: { label: string; value: string; values: { value: string; label: string }[]; onChange: (value: string) => void }) {
  return <label>{label}<select aria-label={label} value={value} onChange={event => onChange(event.target.value)}>{values.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}
const options = (values: string[]) => values.map(value => ({ value, label: value }));

const gapFields: Record<string, string> = {
  'project-name-missing': 'Project name', 'requester-missing': 'Requesting company and contact',
  'reply-address-missing': 'Reply address or email', 'retention-review-missing': 'Retention review date', 'retention-review-due': 'Retention review date',
  'title-number-missing': 'Title number', 'title-evidence-missing': 'Title evidence reference', 'title-evidence-date-missing': 'Title evidence date',
  'title-relationship-unconfirmed': 'Parcel relationship', 'title-extent-missing': 'Extent assessment and plan reference',
  'title-unchecked': 'Title assessment', 'title-reviewer-missing': 'Title checked by', 'title-review-date-missing': 'Title checked on',
  'party-name-missing': 'Party name', 'party-title-missing': 'Related title', 'contact-route-missing': 'Contact email',
  'contact-source-missing': 'Contact source and permitted-use assessment', 'contact-check-date-missing': 'Contact checked on',
  'contact-use-unconfirmed': 'Commercial contact use', 'authority-evidence-missing': 'Authority evidence reference',
  'authority-reviewer-missing': 'Authority checked by', 'authority-review-date-missing': 'Authority checked on',
  'request-activities-missing': 'Proposed activities', 'request-scope-missing': 'Exact land scope and plan reference',
  'request-not-sent': 'Consent decision', 'request-date-missing': 'Request sent on', 'response-date-missing': 'Response received on',
  'decision-evidence-missing': 'Consent evidence reference', 'valid-from-missing': 'Valid from', 'valid-until-missing': 'Valid until',
  'signatory-missing': 'Signatory name and capacity', 'correspondence-date-missing': 'Correspondence date',
  'correspondence-summary-missing': 'Correspondence summary', 'correspondence-evidence-missing': 'Correspondence evidence reference',
};

export function ConsentEditor({ value, onChange, disabled, savedId, savedReady, documents, onUpload, onRequest }: {
  value: ConsentWorkflow; onChange: (value: ConsentWorkflow) => void; disabled: boolean;
  savedId?: string; savedReady: boolean; documents: EvidenceDocument[];
  onUpload: (file: File) => void; onRequest: (id: string) => void;
}) {
  const [tab, setTab] = useState('Project');
  const [focusGap, setFocusGap] = useState<ReadinessGap | null>(null);
  const fields = useRef<HTMLFieldSetElement>(null);
  useEffect(() => {
    if (!focusGap || !fields.current) return;
    const section = fields.current;
    const record = Array.from(section.querySelectorAll<HTMLElement>('[data-record-id]')).find(element => element.dataset.recordId === focusGap.recordId);
    const scope = record ?? section;
    const field = Array.from(scope.querySelectorAll<HTMLElement>('[aria-label]')).find(element => element.getAttribute('aria-label') === gapFields[focusGap.code]);
    const add = !focusGap.recordId ? scope.querySelector<HTMLButtonElement>('button:not(:disabled)') : null;
    const target = !disabled && field && !field.matches(':disabled') ? field : add ?? section;
    target.focus();
    target.scrollIntoView({ block: 'center' });
    setFocusGap(null);
  }, [focusGap, tab, disabled]);
  function gapLabel(gap: ReadinessGap) {
    const titleIndex = value.titles.findIndex(record => record.id === gap.recordId);
    if (gap.section === 'Titles' && titleIndex >= 0) return `Title ${titleIndex + 1}: ${value.titles[titleIndex].titleNumber || 'Unnamed title'}`;
    const partyIndex = value.parties.findIndex(record => record.id === gap.recordId);
    if (gap.section === 'Parties' && partyIndex >= 0) return `Party ${partyIndex + 1}: ${value.parties[partyIndex].name || 'Unnamed party'}`;
    const records = gap.section === 'Requests' ? value.consents : value.correspondence;
    const index = records.findIndex(record => record.id === gap.recordId);
    if (index >= 0) return `${gap.section === 'Requests' ? 'Request' : 'Correspondence'} ${index + 1}: ${value.parties.find(party => party.id === records[index].partyId)?.name || 'Missing party'}`;
    return gap.section;
  }
  const readiness = evaluateEvidenceReadiness(value, documents);
  const gapSections = [...new Set(readiness.gaps.map(gap => gap.section))];
  const parties = [{ value: '', label: 'Select party' }, ...value.parties.map(party => ({ value: party.id, label: party.name || 'Unnamed party' }))];
  function remove(key: 'titles' | 'parties' | 'consents' | 'correspondence', id: string) {
    if (window.confirm('Remove this record from the current case? Previously saved revisions remain in the audit history.')) onChange({ ...value, [key]: value[key].filter(record => record.id !== id) });
  }
  return <section className="consent-editor" aria-label="Landowner contact and consent">
    <h3>Landowner contact and consent</h3>
    <div className="case-summary"><span>{value.titles.filter(title => title.verification === 'checked').length} titles checked</span><span>{value.parties.length} parties</span><span>{value.consents.filter(permission => effectiveConsentStatus(permission) === 'granted').length} currently granted</span></div>
    <p className="case-caution">Recorded consent is scope-specific, not a clearance to start work. Other rights-holder approvals may be required.</p>
    <section className="readiness-summary" aria-labelledby="readiness-heading">
      <div className="readiness-heading"><div><h4 id="readiness-heading">Evidence readiness</h4><p>Factual record check as at {readiness.evaluatedOn}</p></div><strong>{readiness.counts.unresolvedGaps} gaps</strong></div>
      <div className="readiness-counts"><span>{readiness.counts.checkedTitles}/{readiness.counts.titles} titles checked</span><span>{readiness.counts.approvedContacts}/{readiness.counts.parties} contact uses approved</span><span>Retention: {readiness.retention.state}{readiness.retention.reviewOn ? ` ${readiness.retention.reviewOn}` : ''}</span></div>
      {!!readiness.requests.length && <ul className="readiness-requests">{readiness.requests.map(request => <li key={request.id}><span>{request.partyName}</span><strong>{request.state}</strong>{(request.validFrom || request.validUntil) && <span>{request.validFrom || 'No start'} to {request.validUntil || 'No end'}</span>}</li>)}</ul>}
      {!!gapSections.length && <div className="readiness-links" aria-label="Sections with evidence gaps">{gapSections.map(section => <button type="button" key={section} onClick={() => setTab(section)}>{section}<span>{readiness.gaps.filter(gap => gap.section === section).length}</span></button>)}</div>}
      {!!gapSections.length && <details className="readiness-details"><summary>Gap details ({readiness.gaps.length})</summary><ul>{readiness.gaps.map(gap => <li key={`${gap.section}-${gap.recordId ?? 'section'}-${gap.code}`}><button type="button" onClick={() => { setTab(gap.section); setFocusGap(gap); }}>{gapLabel(gap)}: {gap.message}</button></li>)}</ul></details>}
      <p className="muted">Checks cover recorded information only; additional titles or rights-holders may be missing. This is not a legal or works approval.</p>
      {!gapSections.length && <p className="muted">No factual gaps detected in recorded information.</p>}
    </section>
    <nav className="case-tabs" aria-label="Case sections">{['Project', 'Titles', 'Parties', 'Requests', 'Correspondence', 'Documents'].map(name => <button type="button" key={name} aria-pressed={tab === name} onClick={() => setTab(name)}>{name}</button>)}</nav>
    <fieldset ref={fields} tabIndex={-1} disabled={disabled} className="case-fields"><legend>{tab}</legend>
      {tab === 'Project' && <div className="case-grid">
        <Field label="Project name" value={value.project} onChange={project => onChange({ ...value, project })} />
        <Field label="Requesting company and contact" value={value.requester} onChange={requester => onChange({ ...value, requester })} />
        <Field label="Reply address or email" value={value.replyAddress} multiline onChange={replyAddress => onChange({ ...value, replyAddress })} />
        <Field label="Retention review date" value={value.retentionReviewOn} type="date" onChange={retentionReviewOn => onChange({ ...value, retentionReviewOn })} />
      </div>}
      {tab === 'Titles' && <>
        {value.titles.map((title, index) => {
          const update = (patch: Partial<typeof title>) => onChange({ ...value, titles: value.titles.map(record => record.id === title.id ? { ...record, ...patch } : record) });
          return <fieldset className="case-record" data-record-id={title.id} key={title.id}><legend>Title {index + 1}</legend><div className="case-grid">
            <Field label="Title number" value={title.titleNumber} onChange={titleNumber => update({ titleNumber: titleNumber.toUpperCase() })} />
            <Choice label="Tenure" value={title.tenure} values={options(['freehold', 'leasehold', 'other'])} onChange={tenure => update({ tenure: tenure as typeof title.tenure })} />
            <Field label="Title evidence reference" value={title.evidenceRef} multiline onChange={evidenceRef => update({ evidenceRef })} />
            <Field label="Title evidence date" value={title.evidenceDate} type="date" onChange={evidenceDate => update({ evidenceDate })} />
            <Choice label="Parcel relationship" value={title.relationship} values={options(['unconfirmed', 'whole', 'part', 'related'])} onChange={relationship => update({ relationship: relationship as typeof title.relationship })} />
            <Field label="Extent assessment and plan reference" value={title.extentNotes} multiline onChange={extentNotes => update({ extentNotes })} />
            <Choice label="Title assessment" value={title.verification} values={options(['unverified', 'checked'])} onChange={verification => update({ verification: verification as typeof title.verification })} />
            <Field label="Title checked by" value={title.reviewedBy} onChange={reviewedBy => update({ reviewedBy })} />
            <Field label="Title checked on" value={title.reviewedOn} type="date" onChange={reviewedOn => update({ reviewedOn })} />
          </div><button type="button" title="Remove title (unlink parties first)" aria-label={`Remove title ${index + 1}`} disabled={value.parties.some(party => party.titleId === title.id)} onClick={() => remove('titles', title.id)}><Trash2 size={16} /></button></fieldset>;
        })}
        <button type="button" disabled={value.titles.length >= 30} onClick={() => onChange({ ...value, titles: [...value.titles, { id: crypto.randomUUID(), titleNumber: '', tenure: 'freehold', evidenceRef: '', evidenceDate: '', relationship: 'unconfirmed', extentNotes: '', verification: 'unverified', reviewedBy: '', reviewedOn: '' }] })}><Plus size={16} />Add title</button>
      </>}
      {tab === 'Parties' && <>
        <p className="case-caution">Contact details must come from a source approved for this commercial purpose. Price Paid addresses are not a contact list. Authority to grant permission needs a separate check.</p>
        {value.parties.map((party, index) => {
          const update = (patch: Partial<typeof party>) => onChange({ ...value, parties: value.parties.map(record => record.id === party.id ? { ...record, ...patch } : record) });
          return <fieldset className="case-record" data-record-id={party.id} key={party.id}><legend>Party {index + 1}</legend><div className="case-grid">
            <Field label="Party name" value={party.name} onChange={name => update({ name })} />
            <Choice label="Party capacity" value={party.capacity} values={options(['registered proprietor', 'leaseholder', 'occupier', 'agent', 'other'])} onChange={capacity => update({ capacity: capacity as typeof party.capacity })} />
            <Choice label="Related title" value={party.titleId} values={[{ value: '', label: 'Not linked' }, ...value.titles.map(title => ({ value: title.id, label: title.titleNumber }))]} onChange={titleId => update({ titleId })} />
            <Field label="Correspondence address" value={party.postalAddress} multiline onChange={postalAddress => update({ postalAddress })} />
            <Field label="Contact email" value={party.email} type="email" onChange={email => update({ email })} />
            <Field label="Contact phone" value={party.phone} onChange={phone => update({ phone })} />
            <Field label="Contact source and permitted-use assessment" value={party.contactSource} multiline onChange={contactSource => update({ contactSource })} />
            <Field label="Contact checked on" value={party.contactCheckedOn} type="date" onChange={contactCheckedOn => update({ contactCheckedOn })} />
            <Choice label="Commercial contact use" value={party.contactUse} values={options(['unconfirmed', 'approved'])} onChange={contactUse => update({ contactUse: contactUse as typeof party.contactUse })} />
            <Field label="Authority evidence reference" value={party.authorityEvidence} multiline onChange={authorityEvidence => update({ authorityEvidence })} />
            <Field label="Authority checked by" value={party.authorityCheckedBy} onChange={authorityCheckedBy => update({ authorityCheckedBy })} />
            <Field label="Authority checked on" value={party.authorityCheckedOn} type="date" onChange={authorityCheckedOn => update({ authorityCheckedOn })} />
          </div><button type="button" title="Remove party (remove related requests and correspondence first)" aria-label={`Remove party ${index + 1}`} disabled={value.consents.some(permission => permission.partyId === party.id) || value.correspondence.some(entry => entry.partyId === party.id)} onClick={() => remove('parties', party.id)}><Trash2 size={16} /></button></fieldset>;
        })}
        <button type="button" disabled={value.parties.length >= 50} onClick={() => onChange({ ...value, parties: [...value.parties, { id: crypto.randomUUID(), name: '', capacity: 'registered proprietor', titleId: '', postalAddress: '', email: '', phone: '', contactSource: '', contactCheckedOn: '', contactUse: 'unconfirmed', authorityEvidence: '', authorityCheckedBy: '', authorityCheckedOn: '' }] })}><Plus size={16} />Add party</button>
      </>}
      {tab === 'Requests' && <>
        {value.consents.map((permission, index) => {
          const update = (patch: Partial<typeof permission>) => onChange({ ...value, consents: value.consents.map(record => record.id === permission.id ? { ...record, ...patch } : record) });
          return <fieldset className="case-record" data-record-id={permission.id} key={permission.id}><legend>Consent {index + 1}: {effectiveConsentStatus(permission)}</legend><div className="case-grid">
            <Choice label="Consent party" value={permission.partyId} values={parties} onChange={partyId => update({ partyId })} />
            <Choice label="Consent decision" value={permission.status} values={options(['not requested', 'awaiting response', 'granted', 'refused', 'revoked'])} onChange={status => update({ status: status as typeof permission.status })} />
            <Field label="Proposed activities" value={permission.activities} multiline onChange={activities => update({ activities })} />
            <Field label="Exact land scope and plan reference" value={permission.landScope} multiline onChange={landScope => update({ landScope })} />
            <Field label="Request sent on" value={permission.requestedOn} type="date" onChange={requestedOn => update({ requestedOn })} />
            <Field label="Response received on" value={permission.responseOn} type="date" onChange={responseOn => update({ responseOn })} />
            <Field label="Valid from" value={permission.validFrom} type="date" onChange={validFrom => update({ validFrom })} />
            <Field label="Valid until" value={permission.validUntil} type="date" onChange={validUntil => update({ validUntil })} />
            <Field label="Conditions and restrictions" value={permission.conditions} multiline onChange={conditions => update({ conditions })} />
            <Field label="Signatory name and capacity" value={permission.signatory} onChange={signatory => update({ signatory })} />
            <Field label="Consent evidence reference" value={permission.evidenceRef} multiline onChange={evidenceRef => update({ evidenceRef })} />
          </div><div className="case-actions"><button type="button" disabled={!savedReady} onClick={() => onRequest(permission.id)}><Printer size={16} />Request draft</button><button type="button" title="Remove consent record" aria-label={`Remove consent ${index + 1}`} onClick={() => remove('consents', permission.id)}><Trash2 size={16} /></button></div></fieldset>;
        })}
        <button type="button" disabled={!value.parties.length || value.consents.length >= 100} onClick={() => onChange({ ...value, consents: [...value.consents, { id: crypto.randomUUID(), partyId: value.parties[0].id, activities: '', landScope: '', status: 'not requested', requestedOn: '', responseOn: '', validFrom: '', validUntil: '', conditions: '', signatory: '', evidenceRef: '' }] })}><Plus size={16} />Add consent request</button>
      </>}
      {tab === 'Correspondence' && <>
        {value.correspondence.map((entry, index) => {
          const update = (patch: Partial<typeof entry>) => onChange({ ...value, correspondence: value.correspondence.map(record => record.id === entry.id ? { ...record, ...patch } : record) });
          return <fieldset className="case-record" data-record-id={entry.id} key={entry.id}><legend>Correspondence {index + 1}</legend><div className="case-grid">
            <Choice label="Correspondence party" value={entry.partyId} values={parties} onChange={partyId => update({ partyId })} />
            <Field label="Correspondence date" value={entry.date} type="date" onChange={date => update({ date })} />
            <Choice label="Contact method" value={entry.method} values={options(['email', 'letter', 'phone', 'meeting', 'other'])} onChange={method => update({ method: method as typeof entry.method })} />
            <Choice label="Direction" value={entry.direction} values={options(['incoming', 'outgoing'])} onChange={direction => update({ direction: direction as typeof entry.direction })} />
            <Field label="Correspondence summary" value={entry.summary} multiline onChange={summary => update({ summary })} />
            <Field label="Correspondence evidence reference" value={entry.evidenceRef} multiline onChange={evidenceRef => update({ evidenceRef })} />
          </div><button type="button" title="Remove correspondence" aria-label={`Remove correspondence ${index + 1}`} onClick={() => remove('correspondence', entry.id)}><Trash2 size={16} /></button></fieldset>;
        })}
        <button type="button" disabled={!value.parties.length || value.correspondence.length >= 200} onClick={() => onChange({ ...value, correspondence: [...value.correspondence, { id: crypto.randomUUID(), partyId: value.parties[0].id, date: '', method: 'email', direction: 'incoming', summary: '', evidenceRef: '' }] })}><Plus size={16} />Add correspondence</button>
      </>}
      {tab === 'Documents' && <>
        <label className="document-input"><FilePlus2 size={18} />Evidence document<input aria-label="Evidence document" type="file" accept=".pdf,.png,.jpg,.jpeg,.txt" disabled={!savedReady || documents.length >= 50} onChange={event => { const file = event.target.files?.[0]; if (file) onUpload(file); event.target.value = ''; }} /></label>
        {!savedReady && <p className="muted">Save case changes before attaching files.</p>}
        <p className="muted">PDF, PNG, JPEG or text. Maximum 3 MB each, 50 documents per case. Files are retained with case history.</p>
        {documents.map(document => <article className="case-document" key={document.id}><strong>{document.name}</strong><span>{Math.ceil(document.size / 1024)} KB / {document.uploadedAt.slice(0, 10)}</span><code>doc:{document.id}</code><span className="mono">SHA-256: {document.sha256}</span><a href={`/api/investigations/${savedId}/documents/${document.id}`}><Download size={16} />Download evidence</a></article>)}
      </>}
    </fieldset>
  </section>;
}