import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Download, X } from 'lucide-react';
import { imageDimensionsFromData } from 'image-dimensions';
import type { EvidenceDocument } from '../../../packages/contracts/src/consent.ts';
import { OcrReview } from './OcrReview.tsx';

const PdfPreview = lazy(() => import('./PdfPreview.tsx'));

export function DocumentPreview({ caseId, document, onClose }: { caseId: string; document: EvidenceDocument; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [content, setContent] = useState<{ bytes: Uint8Array; url: string } | null>(null);
  const [error, setError] = useState('');
  const url = `/api/investigations/${caseId}/documents/${document.id}`;
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = '';
    void (async () => {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error('Evidence could not be loaded. Close the preview and retry.');
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > 3_000_000 || buffer.byteLength !== document.size) throw new Error('Evidence size does not match its saved record.');
      const digest = await crypto.subtle.digest('SHA-256', buffer);
      const sha256 = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
      if (sha256 !== document.sha256) throw new Error('Evidence integrity check failed. Do not rely on this preview.');
      if (document.mediaType.startsWith('image/')) {
        const dimensions = imageDimensionsFromData(new Uint8Array(buffer));
        if (!dimensions || !['png', 'jpeg'].includes(dimensions.type) || !dimensions.width || !dimensions.height) throw new Error('Image header is invalid or unsupported.');
        if (dimensions.width * dimensions.height > 16_000_000 || dimensions.width > 8192 || dimensions.height > 8192) throw new Error('Image exceeds the preview size limit. Download the original for inspection.');
      }
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(new Blob([buffer], { type: document.mediaType }));
      setContent({ bytes: new Uint8Array(buffer), url: objectUrl });
    })().catch(caught => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'Evidence preview unavailable'); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [url, document]);
  return <dialog ref={dialog} className="document-preview" aria-label="Evidence preview" onCancel={onClose} onClose={onClose}>
    <header><h2>{document.name}</h2><a href={url} aria-label="Download original evidence" title="Download original evidence"><Download size={18} /></a><button type="button" aria-label="Close evidence preview" title="Close evidence preview" onClick={onClose}><X size={18} /></button></header>
    <p className="mono">SHA-256: {document.sha256}</p>
    {error ? <p role="alert">{error}</p> : !content ? <p aria-live="polite">Loading evidence</p> : document.mediaType === 'application/pdf' ? <Suspense fallback={<p>Loading PDF renderer</p>}><PdfPreview bytes={content.bytes} source={document} /></Suspense>
      : document.mediaType === 'text/plain' ? <pre className="document-text">{new TextDecoder().decode(content.bytes)}</pre>
        : <img src={content.url} alt={document.name} onError={() => setError('Image preview unavailable. Download the original for inspection.')} />}
    {!error && content && document.mediaType.startsWith('image/') && <OcrReview source={document} page={null} image={async signal => {
      const bitmap = await createImageBitmap(new Blob([content.bytes.slice().buffer], { type: document.mediaType }));
      try {
        if (signal.aborted) throw new Error('Cancelled');
        const scale = Math.min(1, Math.sqrt(4_000_000 / (bitmap.width * bitmap.height)), 4096 / Math.max(bitmap.width, bitmap.height));
        const canvas = new OffscreenCanvas(Math.max(1, Math.floor(bitmap.width * scale)), Math.max(1, Math.floor(bitmap.height * scale)));
        const context = canvas.getContext('2d')!;
        context.fillStyle = 'white'; context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        return await canvas.convertToBlob({ type: 'image/png' });
      } finally { bitmap.close(); }
    }} />}
  </dialog>;
}