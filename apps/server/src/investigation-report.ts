import type { Investigation } from '../../../packages/contracts/src/investigation.ts';
import { parcelBounds } from '../../../packages/contracts/src/ownership.ts';
import { consentReport } from './consent-report.ts';

function escape(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

export function investigationReport(item: Investigation, nonce: string): string {
  const { parcel, manifest } = item.snapshot;
  const parcels = item.snapshot.parcels ?? [parcel];
  const hasTitleAssessment = item.workflow?.titles.some(title => title.verification === 'checked');
  const sales = item.snapshot.sales;
  const saleEvidence = `<section><h2>Recorded sales</h2>${sales ? `<p>HMLR publication period ${escape(sales.period)}. New and updated records, not a complete sale history.</p>${sales.records.length ? sales.records.map(record => `<article><h3>${escape(new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(record.price))} | ${escape(record.date)}</h3><p>${escape(record.address)}</p><p>${escape(record.propertyType)}; freehold; ${record.newBuild ? 'new build' : 'existing property'}; ${escape(record.category)} Price Paid record.</p><p>Transaction ${escape(record.transactionId)}<br>Associated INSPIRE IDs: ${escape(record.inspireIds.join(', '))}</p><p>The amount is for the transaction, not an allocation to this polygon.</p></article>`).join('') : '<p>No linked sale in the captured release. This is not evidence that the property has never sold.</p>'}<p>${escape(sales.attribution)}</p><p>Address data remains subject to Price Paid Data conditions.</p><p><a href="https://www.gov.uk/government/statistical-data-sets/price-paid-data-downloads#using-or-publishing-our-price-paid-data">Price Paid Data conditions</a></p>${sales.sources.map(source => `<p>Source: ${escape(source.url)}<br>SHA-256: ${escape(source.sha256)}</p>`).join('')}` : '<p>No sales release captured in this investigation.</p>'}<p>Sale records do not identify the current owner or establish a title-number relationship.</p></section>`;
  const bounds = parcelBounds(parcels);
  let outline = '<p>Parcel outline unavailable.</p>';
  if (bounds) {
    const [[west, south], [east, north]] = bounds;
    const longitudeScale = Math.cos((south + north) / 2 * Math.PI / 180);
    const scale = Math.min(640 / Math.max((east - west) * longitudeScale, 1e-10), 280 / Math.max(north - south, 1e-10));
    const width = (east - west) * longitudeScale * scale;
    const height = (north - south) * scale;
    const paths = parcels.map(included => {
      const rings = included.geometry.coordinates.map(ring => ring.map(([longitude, latitude], index) =>
        `${index ? 'L' : 'M'}${((longitude - west) * longitudeScale * scale + (720 - width) / 2).toFixed(2)},${((north - latitude) * scale + (340 - height) / 2).toFixed(2)}`).join(' ') + 'Z').join(' ');
      return `<path d="${rings}" fill="#d7e9df" fill-rule="evenodd" stroke="#28775c" stroke-width="2"><title>${escape(included.id)}</title></path>`;
    }).join('');
    outline = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 340" role="img" aria-label="Saved parcel outline, north up">${paths}</svg>`;
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(item.name)} | Fieldwork report</title><style>
body{font-family:Georgia,serif;color:#20382c;background:#fff;margin:0;line-height:1.5;overflow-wrap:anywhere}main{max-width:800px;padding:32px;margin:auto}h1{font-size:28px;line-height:1.2}h2{font-size:19px;border-bottom:1px solid #ccd8d0;padding-bottom:6px}header{border-bottom:3px solid #28775c}dl{display:grid;grid-template-columns:160px 1fr;gap:8px}dt{font-weight:bold}dd{margin:0}.notes{white-space:pre-wrap}figure{margin:24px 0}svg{width:100%;max-height:340px}figcaption,footer{font-size:13px}button{font:inherit;padding:8px 14px;cursor:pointer;background:#fff;border:1px solid #28775c}section,figure{break-inside:avoid}section.notes-section{break-inside:auto}.toolbar{display:flex;justify-content:flex-end}footer{border-top:1px solid #ccd8d0;margin-top:24px;padding-top:12px}@media(max-width:500px){main{padding:18px}dl{grid-template-columns:1fr;gap:4px}dd{margin-bottom:10px}}@media print{.toolbar{display:none}main{padding:0;max-width:none}h2{break-after:avoid}p{orphans:3;widows:3}@page{margin:18mm}}
</style></head><body><main><div class="toolbar"><button id="print-report" type="button">Print / Save as PDF</button></div>
<header><p>FIELDWORK / INVESTIGATION REPORT</p><h1>${escape(item.name)}</h1><p>Saved revision ${item.revision} | ${escape(item.updatedAt)}</p></header>
<section><h2>Investigation question</h2><p class="notes">${escape(item.question || 'Not recorded')}</p></section>
<section><h2>Source facts</h2><dl><dt>Parcel references</dt><dd>${escape(parcels.map(included => included.id).join(', '))}</dd><dt>Dataset</dt><dd>${escape(manifest.name)}</dd><dt>Source release</dt><dd>${escape(manifest.published)}</dd><dt>INSPIRE IDs</dt><dd>${escape(parcels.map(included => included.source?.inspireId ?? 'Not supplied').join(', '))}</dd><dt>Tenure coverage</dt><dd>Freehold index polygons</dd><dt>Title number</dt><dd>${hasTitleAssessment ? 'Not supplied by INSPIRE; see case title assessments below.' : 'Not established'}</dd><dt>Ownership</dt><dd>${hasTitleAssessment ? 'Not supplied by INSPIRE. Relevant parties and evidence are recorded separately in this case.' : 'Unknown. No ownership evidence loaded.'}</dd></dl></section>
<figure>${outline}<figcaption>Saved parcel outline, north up. Schematic geographic view without a basemap or survey scale. Indicative extent, not a legal title boundary.</figcaption></figure>
${saleEvidence}
${consentReport(item)}
<section class="notes-section"><h2>Analyst notes</h2><p class="notes">${escape(item.notes || 'No notes recorded.')}</p><p>Analyst notes are not independently verified source facts.</p></section>
<section><h2>Unresolved questions</h2><p>${hasTitleAssessment ? 'Title checks and consent decisions are case assessments by your team. Confirm all relevant interests, authority, scope and conditions before relying on them. Additional rights-holder approvals may still be needed.' : 'The parcel-to-title relationship and registered ownership have not been established. Unknown ownership does not imply unregistered land or private ownership.'}</p></section>
<footer><p>${escape(manifest.attribution)}</p><p>${escape(manifest.transform)}</p><p>Source: <a href="https://use-land-property-data.service.gov.uk/datasets/inspire/#conditions">HM Land Registry INSPIRE and conditions</a></p><p>Investigation ${escape(item.id)}<br>Source SHA-256: ${escape(item.snapshot.releaseSha256)}</p><p>This report records an investigation, not legal proof of ownership or a survey.</p></footer>
</main><script nonce="${escape(nonce)}">document.getElementById('print-report').addEventListener('click',()=>window.print());</script></body></html>`;
}