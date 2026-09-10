import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { resolveRuntimeConfig } from '../apps/server/src/config.ts';

test('runtime configuration separates default assets and writable data', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fieldwork-config-'));
  try {
    const config = resolveRuntimeConfig({}, directory);
    assert.equal(config.port, 4317);
    assert.equal(config.assetRoot, resolve(directory, 'dist'));
    assert.equal(config.dataRoot, resolve(directory, '.local'));
    assert.equal(config.journal, join(config.dataRoot, 'demo-reviews.jsonl'));
    assert.equal(config.investigationDb, join(config.dataRoot, 'investigations.sqlite'));
    assert.equal(config.runtimeLock, join(config.dataRoot, '.fieldwork-server.lock'));
    assert.equal(config.pilotPath, join(config.assetRoot, 'pilot', 'parcels.json'));
    assert.equal(config.logPath, join(config.dataRoot, 'logs', 'fieldwork.jsonl'));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('runtime configuration accepts deployment path and port overrides', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fieldwork-config-'));
  try {
    const config = resolveRuntimeConfig({
      PORT: '5317',
      FIELDWORK_ASSET_DIR: 'application-assets',
      FIELDWORK_DATA_DIR: 'writable-data',
    }, directory);
    assert.equal(config.port, 5317);
    assert.equal(config.assetRoot, resolve(directory, 'application-assets'));
    assert.equal(config.dataRoot, resolve(directory, 'writable-data'));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('runtime configuration rejects invalid ports and shared asset data paths', () => {
  assert.throws(() => resolveRuntimeConfig({ PORT: 'not-a-port' }), /PORT must be an integer/);
  assert.throws(() => resolveRuntimeConfig({ PORT: '70000' }), /PORT must be an integer/);
  assert.throws(() => resolveRuntimeConfig({ FIELDWORK_ASSET_DIR: 'shared', FIELDWORK_DATA_DIR: 'shared' }), /outside the application asset directory/);
  assert.throws(() => resolveRuntimeConfig({ FIELDWORK_ASSET_DIR: 'shared', FIELDWORK_DATA_DIR: 'shared/data' }), /outside the application asset directory/);
  assert.throws(() => resolveRuntimeConfig({ FIELDWORK_ASSET_DIR: 'C:\\Fieldwork\\Data', FIELDWORK_DATA_DIR: 'c:\\fieldwork\\data' }, 'C:\\', 'win32'), /outside the application asset directory/);
});