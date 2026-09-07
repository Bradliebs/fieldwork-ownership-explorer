import type { SalesRelease } from '../../../packages/contracts/src/sales.ts';

export function SalesEvidence({ sales }: { sales?: SalesRelease }) {
  return <section className="sales-evidence" aria-label="Recorded sales">
    <h3>Recorded sales</h3>
    {!sales ? <p>No sales release captured.</p> : <>
      <p className="muted">HMLR publication period {sales.period}. New and updated records, not a complete sale history.</p>
      {!sales.records.length ? <p>No linked sale in this release. This does not mean the property has never sold.</p> : sales.records.map(record => <article key={record.transactionId} className="sale-record">
        <div className="sale-heading"><strong>{new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(record.price)}</strong><time dateTime={record.date}>{record.date}</time></div>
        <p>{record.address}</p>
        <p>{record.propertyType} / Freehold / {record.newBuild ? 'New build' : 'Existing property'} / {record.category}</p>
        <p className="mono">Transaction {record.transactionId}</p>
        <p>Associated INSPIRE IDs: {record.inspireIds.join(', ')}</p>
        <p>The amount is for the transaction, not an allocation to this polygon.</p>
      </article>)}
      <details><summary>Sale source and conditions</summary><p>{sales.attribution}</p><p>Address data remains subject to <a href={sales.addressConditions} target="_blank" rel="noreferrer">Price Paid Data conditions</a>.</p><p>Imported {sales.importedAt}</p>{sales.sources.map(source => <p className="mono" key={source.url}>{source.url}<br />SHA-256: {source.sha256}</p>)}</details>
    </>}
    <p>Sale records do not identify the current owner or establish a title-number relationship.</p>
  </section>;
}