import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const pdfAssets = ['cmaps', 'standard_fonts', 'wasm', 'iccs'].flatMap(folder =>
	readdirSync(resolve('node_modules/pdfjs-dist', folder)).filter(name => !name.startsWith('quickjs-')).map(name => ({ name: `pdf-assets/${folder}/${name}`, path: resolve('node_modules/pdfjs-dist', folder, name) })));
const ocrAssets = [
	{ name: 'ocr-assets/worker.min.js', path: resolve('node_modules/tesseract.js/dist/worker.min.js') },
	{ name: 'ocr-assets/worker.min.js.LICENSE.txt', path: resolve('node_modules/tesseract.js/dist/worker.min.js.LICENSE.txt') },
	{ name: 'ocr-assets/TESSERACT-LICENSE.md', path: resolve('node_modules/tesseract.js/LICENSE.md') },
	{ name: 'ocr-assets/CORE-LICENSE.txt', path: resolve('node_modules/tesseract.js-core/LICENSE') },
	{ name: 'ocr-assets/LANGUAGE-PACKAGE.json', path: resolve('node_modules/@tesseract.js-data/eng/package.json') },
	{ name: 'ocr-assets/eng.traineddata.gz', path: resolve('node_modules/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz') },
	...readdirSync(resolve('node_modules/tesseract.js-core')).filter(name => /-lstm\.wasm(?:\.js)?$/.test(name)).map(name => ({ name: `ocr-assets/${name}`, path: resolve('node_modules/tesseract.js-core', name) })),
];
const localAssets = [...pdfAssets, ...ocrAssets];

export default defineConfig({ plugins: [react(), {
	name: 'local-pdf-assets',
	generateBundle() {
		for (const asset of localAssets) this.emitFile({ type: 'asset', fileName: asset.name, source: readFileSync(asset.path) });
	},
	configureServer(server) {
		server.middlewares.use((request, response, next) => {
			const asset = localAssets.find(item => `/${item.name}` === request.url);
			if (!asset) return next();
			response.setHeader('Content-Type', asset.name.endsWith('.wasm') ? 'application/wasm' : asset.name.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
			response.end(readFileSync(asset.path));
		});
	},
}], build: { chunkSizeWarningLimit: 1100 } });