import { createWorker, OEM } from 'tesseract.js';

self.onmessage = async (event: MessageEvent<Blob>) => {
  let engine: Awaited<ReturnType<typeof createWorker>> | undefined;
  try {
    engine = await createWorker('eng', OEM.LSTM_ONLY, {
      workerPath: new URL('/ocr-assets/worker.min.js', self.location.origin).href,
      corePath: new URL('/ocr-assets/', self.location.origin).href,
      langPath: new URL('/ocr-assets/', self.location.origin).href,
      cacheMethod: 'none', workerBlobURL: false,
      logger: progress => self.postMessage({ type: 'progress', status: progress.status, progress: progress.progress }),
      errorHandler: () => self.postMessage({ type: 'error' }),
    });
    const result = await engine.recognize(event.data, {}, { text: true });
    self.postMessage({ type: 'result', text: result.data.text.slice(0, 100_000), confidence: result.data.confidence });
  } catch { self.postMessage({ type: 'error' }); }
  finally { await engine?.terminate(); }
};