import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Minus, Plus } from 'lucide-react';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { OcrReview } from './OcrReview.tsx';
import type { EvidenceDocument } from '../../../packages/contracts/src/consent.ts';

GlobalWorkerOptions.workerSrc = workerUrl;

export default function PdfPreview({ bytes, source }: { bytes: Uint8Array; source: EvidenceDocument }) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [text, setText] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null);
  const [availableWidth, setAvailableWidth] = useState(600);
  useEffect(() => {
    const container = canvas.current?.parentElement;
    if (!container) return;
    const observer = new ResizeObserver(() => setAvailableWidth(container.clientWidth));
    observer.observe(container);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let active = true;
    const task = getDocument({ data: bytes.slice(), cMapUrl: '/pdf-assets/cmaps/', standardFontDataUrl: '/pdf-assets/standard_fonts/', wasmUrl: '/pdf-assets/wasm/', iccUrl: '/pdf-assets/iccs/',
      enableXfa: false, stopAtErrors: true, maxImageSize: 16_000_000, canvasMaxAreaInBytes: 32_000_000, verbosity: 0 });
    const timer = window.setTimeout(() => { if (active) { setError('PDF preview exceeded its time limit. The original remains available for download.'); void task.destroy(); } }, 20_000);
    task.promise.then(pdf => {
      if (!active) return;
      if (pdf.numPages > 200) { setError('PDF preview is limited to 200 pages. Download the original for inspection.'); void task.destroy(); return; }
      setDocument(pdf);
    }).catch(() => { if (active) setError('PDF preview unavailable. The file may be damaged, encrypted or unsupported. Download the original for inspection.'); })
      .finally(() => window.clearTimeout(timer));
    return () => { active = false; window.clearTimeout(timer); void task.destroy(); };
  }, [bytes]);
  useEffect(() => {
    if (!document || !canvas.current) return;
    let active = true;
    let cancel: (() => void) | undefined;
    setReady(false); setText(''); setError('');
    const timer = window.setTimeout(() => { if (active) { active = false; cancel?.(); setError('PDF page exceeded its rendering time limit.'); } }, 20_000);
    void (async () => {
      const page = await document.getPage(pageNumber);
      if (!active || !canvas.current) return;
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(1, availableWidth / base.width) * scale });
      if (viewport.width * viewport.height > 8_000_000 || viewport.width > 8192 || viewport.height > 8192) throw new Error('PDF page exceeds the preview size limit. Reduce zoom or download the original.');
      const target = canvas.current;
      target.width = Math.ceil(viewport.width); target.height = Math.ceil(viewport.height);
      const task = page.render({ canvas: target, viewport, annotationMode: 0 });
      cancel = () => task.cancel();
      await task.promise;
      const content = await page.getTextContent();
      if (active) { setText(content.items.map(item => 'str' in item ? item.str : '').join(' ').slice(0, 100_000)); setReady(true); }
    })().catch(caught => { if (active) setError(caught instanceof Error ? caught.message : 'PDF page preview unavailable'); })
      .finally(() => window.clearTimeout(timer));
    return () => { active = false; cancel?.(); window.clearTimeout(timer); };
  }, [document, pageNumber, scale, availableWidth]);
  return <div className="pdf-preview">
    <div className="preview-tools">
      <button type="button" title="Previous page" aria-label="Previous page" disabled={!document || pageNumber <= 1} onClick={() => setPageNumber(previous => previous - 1)}><ChevronLeft size={18} /></button>
      <label>Page<input aria-label="PDF page" type="number" min={1} max={document?.numPages ?? 1} value={pageNumber} onChange={event => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 1 && value <= (document?.numPages ?? 1)) setPageNumber(value); }} /></label><span>of {document?.numPages ?? '?'}</span>
      <button type="button" title="Next page" aria-label="Next page" disabled={!document || pageNumber >= document.numPages} onClick={() => setPageNumber(previous => previous + 1)}><ChevronRight size={18} /></button>
      <button type="button" title="Reduce PDF zoom" aria-label="Reduce PDF zoom" disabled={scale <= 0.5} onClick={() => setScale(previous => previous - 0.25)}><Minus size={18} /></button><span>{scale * 100}%</span>
      <button type="button" title="Increase PDF zoom" aria-label="Increase PDF zoom" disabled={scale >= 2} onClick={() => setScale(previous => previous + 0.25)}><Plus size={18} /></button>
    </div>
    <p className="case-caution">Visual preview only. Interactive forms, annotations and signature validation are excluded. Check the original before relying on it.</p>
    {error && <p role="alert">{error}</p>}
    {!ready && !error && <p aria-live="polite">Rendering PDF page</p>}
    <div className="pdf-page"><canvas ref={canvas} aria-label={`PDF page ${pageNumber}`} data-ready={ready} hidden={!ready || Boolean(error)} /></div>
    {ready && !error && <details><summary>Page text</summary><pre>{text || 'No embedded text on this page.'}</pre></details>}
    {ready && !error && document && <OcrReview key={pageNumber} source={source} page={pageNumber} image={async signal => {
      const page = await document.getPage(pageNumber);
      if (signal.aborted) throw new Error('Cancelled');
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(2, Math.sqrt(4_000_000 / (base.width * base.height)), 4096 / Math.max(base.width, base.height)) });
      const target = window.document.createElement('canvas');
      target.width = Math.max(1, Math.floor(viewport.width)); target.height = Math.max(1, Math.floor(viewport.height));
      const render = page.render({ canvas: target, viewport, annotationMode: 0 });
      const cancel = () => render.cancel();
      signal.addEventListener('abort', cancel, { once: true });
      try {
        await render.promise;
        return await new Promise<Blob>((resolve, reject) => target.toBlob(blob => blob ? resolve(blob) : reject(new Error('Image unavailable')), 'image/png'));
      } finally { signal.removeEventListener('abort', cancel); target.width = 0; target.height = 0; }
    }} />}
  </div>;
}