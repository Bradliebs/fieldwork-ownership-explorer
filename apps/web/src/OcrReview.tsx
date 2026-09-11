import { useEffect, useRef, useState } from 'react';
import { Download, ScanText, X } from 'lucide-react';
import type { EvidenceDocument } from '../../../packages/contracts/src/consent.ts';

export function OcrReview({ source, page, image }: { source: EvidenceDocument; page: number | null; image: (signal: AbortSignal) => Promise<Blob> }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [result, setResult] = useState<{ original: string; confidence: number; date: string } | null>(null);
  const [text, setText] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [error, setError] = useState('');
  const job = useRef<{ worker?: Worker; controller: AbortController; timer?: number } | null>(null);
  function stop() {
    job.current?.controller.abort();
    job.current?.worker?.terminate();
    window.clearTimeout(job.current?.timer);
    job.current = null;
  }
  useEffect(() => () => stop(), []);
  async function recognize() {
    stop(); setBusy(true); setResult(null); setText(''); setReviewed(false); setError(''); setStatus('Preparing image');
    const current: NonNullable<typeof job.current> = { controller: new AbortController() };
    job.current = current;
    const fail = (message: string) => { if (job.current === current) { stop(); setBusy(false); setError(message); } };
    current.timer = window.setTimeout(() => fail('OCR exceeded its 60 second limit. No case records changed.'), 60_000);
    try {
      const bitmap = await image(current.controller.signal);
      if (current.controller.signal.aborted) return;
      const worker = new Worker(new URL('./ocr-worker.ts', import.meta.url), { type: 'module' });
      current.worker = worker;
      worker.onerror = () => fail('Local OCR failed. No case records changed.');
      worker.onmessage = event => {
        if (current.controller.signal.aborted) return;
        const message = event.data;
        if (message.type === 'error') fail('Local OCR failed. Check the image and try again.');
        if (message.type === 'progress') setStatus(`${message.status}: ${Math.round(message.progress * 100)}%`);
        if (message.type === 'result') {
          setResult({ original: message.text, confidence: message.confidence, date: new Date().toISOString() });
          setText(message.text); setBusy(false); stop();
        }
      };
      worker.postMessage(bitmap);
    } catch { fail('Image could not be prepared for OCR. No case records changed.'); }
  }
  function download() {
    if (!result || !reviewed) return;
    const transcript = `REVIEWED OCR TRANSCRIPT / NOT VERIFIED EVIDENCE\nDocument: ${source.name}\nReference: doc:${source.id}\nSHA-256: ${source.sha256}\nPage: ${page ?? 'image'}\nEngine: Tesseract.js 7 / English 4.0.0\nRecognized: ${result.date}\nEngine confidence: ${result.confidence} (not an accuracy guarantee)\nReviewer confirmation: compared with original\n\nREVIEWED TEXT\n${text}\n\nRAW OCR OUTPUT\n${result.original}`;
    const url = URL.createObjectURL(new Blob([transcript], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `ocr-${source.id}-${page ?? 'image'}.txt`; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="ocr-review" aria-label="OCR review">
    <div className="preview-tools"><h3>OCR / English</h3><button type="button" disabled={busy} title="Recognize text locally" aria-label="Recognize text locally" onClick={() => void recognize()}><ScanText size={18} /></button>{busy && <button type="button" title="Cancel OCR" aria-label="Cancel OCR" onClick={() => { stop(); setBusy(false); setStatus('OCR cancelled. No case records changed.'); }}><X size={18} /></button>}</div>
    <p className="case-caution">Machine transcription is unverified. Compare names, dates, title numbers and conditions with the original. No case fields change automatically.</p>
    {status && !result && <p aria-live="polite">{status}</p>}{error && <p role="alert">{error}</p>}
    {result && <>
      <p>{page ? `Page ${page}` : 'Image'} / Engine confidence {Math.round(result.confidence)} / Not an accuracy guarantee</p>
      <label>OCR transcript<textarea rows={8} maxLength={100_000} value={text} onChange={event => { setText(event.target.value); setReviewed(false); }} /></label>
      {!result.original.trim() && <p>No text recognized.</p>}
      <label className="ocr-confirm"><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} />I compared this transcript with the original evidence</label>
      <button type="button" disabled={!reviewed || !text.trim()} title="Download reviewed transcript" aria-label="Download reviewed transcript" onClick={download}><Download size={18} /></button>
    </>}
  </section>;
}