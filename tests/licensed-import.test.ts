import { test } from 'node:test';
import assert from 'node:assert/strict';
import { licensedProviderSchema, providerReadiness, type LicensedProvider } from '../packages/contracts/src/licensed-provider.ts';
import { prepareOwnershipImport } from '../apps/server/src/licensed-import.ts';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { unzipSync, strFromU8, strToU8, zipSync } from 'fflate';
import { stageLicensedOwnership, verifyLicensedArchive } from '../apps/server/src/licensed-staging.ts';
import { spawnSync } from 'node:child_process';

export const profile: LicensedProvider = {
  schemaVersion: 1, id: 'test-ownership', provider: 'Test provider', product: 'Corporate ownership', service: 'ownership', enabled: true,
  access: { mode: 'manual-file' }, licence: { reference: 'Test agreement', termsUrl: 'https://example.invalid/terms', approvedBy: 'Local reviewer',
    approvedOn: '2026-09-01', validFrom: '2026-09-01', validUntil: '2026-09-30', purpose: 'Internal ownership research', coverage: 'Test area only',
    permissions: { localStorage: true, backup: true, ownershipResearch: true, derivedExport: false, commercialContact: false } },
};
export const mapping = { recordId: 'ID', titleNumber: 'Title', proprietor: 'Owner', sourceDate: 'Date', evidenceReference: 'Evidence', inspireId: 'INSPIRE' };
const csv = Buffer.from('ID,Title,Owner,Date,Evidence,INSPIRE\r\n1,AV123,"Example, Limited",2026-09-01,register-1,123\r\n');

test('licensed intake preserves source assertions and checksums without inferring ownership or contact permission', () => {
  const result = prepareOwnershipImport(csv, profile, mapping, '2026-09-11');
  assert.match(result.sourceSha256, /^[a-f0-9]{64}$/);
  assert.equal(result.records[0].proprietor, 'Example, Limited');
  assert.equal(result.records[0].status, 'candidate');
  assert.equal(result.records[0].relationship, 'unconfirmed');
  assert.equal(result.records[0].contactUse, 'unconfirmed');
  assert.equal(result.provider.licence.permissions.derivedExport, false);
  assert.equal(result.mapping.inspireId, 'INSPIRE');
});

test('licensed intake fails closed on disabled, unapproved, expired and unsupported access', () => {
  assert.throws(() => prepareOwnershipImport(csv, { ...profile, enabled: false }, mapping, '2026-09-11'), /disabled/);
  assert.throws(() => prepareOwnershipImport(csv, profile, mapping, '2026-10-01'), /expired/);
  assert.throws(() => prepareOwnershipImport(csv, profile, mapping, '2026-08-31'), /not started/);
  assert.throws(() => prepareOwnershipImport(csv, { ...profile, licence: { ...profile.licence, approvedBy: '' } }, mapping, '2026-09-11'), /review/);
  for (const permission of ['localStorage', 'backup', 'ownershipResearch'] as const) {
    assert.throws(() => prepareOwnershipImport(csv, { ...profile, licence: { ...profile.licence, permissions: { ...profile.licence.permissions, [permission]: false } } }, mapping, '2026-09-11'), /permissions/);
  }
  assert.throws(() => prepareOwnershipImport(csv, { ...profile, service: 'planning' }, mapping, '2026-09-11'), /manual ownership/);
});

test('account preflight never exposes credential values or implies an active API connector', () => {
  const apiProfile = { ...profile, access: { mode: 'api' as const, documentationUrl: 'https://example.invalid/docs', credentialEnv: ['FIELDWORK_PROVIDER_TEST_KEY', 'FIELDWORK_PROVIDER_MISSING_KEY'] } };
  const result = providerReadiness(apiProfile, '2026-09-11', { FIELDWORK_PROVIDER_TEST_KEY: 'secret-value' });
  assert.equal(result.networkEnabled, false);
  assert.equal(result.connector, 'not-implemented');
  assert.deepEqual(result.credentials.map(item => item.configured), [true, false]);
  assert.ok(!JSON.stringify(result).includes('secret-value'));
  assert.throws(() => licensedProviderSchema.parse({ ...apiProfile, apiKey: 'secret-value' }));
  assert.throws(() => licensedProviderSchema.parse({ ...apiProfile, access: { ...apiProfile.access, documentationUrl: 'https://example.invalid/docs?token=secret' } }));
});

test('CSV intake rejects malformed dates, duplicate identifiers, bad headers and excessive records', () => {
  for (const bytes of [Buffer.from(csv.toString().replace('2026-09-01,register', '2026-02-30,register')), Buffer.from(csv.toString() + csv.toString().split('\r\n')[1] + '\r\n'), Buffer.from(csv.toString().replace('ID,Title', 'ID,ID')), Buffer.from([0xff])]) {
    assert.throws(() => prepareOwnershipImport(bytes, profile, mapping, '2026-09-11'));
  }
  assert.throws(() => prepareOwnershipImport(csv, profile, { ...mapping, proprietor: 'Missing' }, '2026-09-11'), /column/);
  assert.throws(() => prepareOwnershipImport(Buffer.from('ID,Title,Owner,Date,Evidence,INSPIRE\n' + '1,AV123,Owner,2026-09-01,ref,123\n'.repeat(10_001)), profile, mapping, '2026-09-11'), /10000/);
});

test('private staging retains original bytes, licence snapshot and candidate hashes; rejects public paths and junctions', () => {
  const directory = mkdtempSync(join(tmpdir(), 'licensed-stage-'));
  try {
    const profilePath = join(directory, 'profile.json'), mappingPath = join(directory, 'mapping.json'), csvPath = join(directory, 'input.csv');
    writeFileSync(profilePath, JSON.stringify(profile)); writeFileSync(mappingPath, JSON.stringify(mapping)); writeFileSync(csvPath, csv);
    const options = { profilePath, mappingPath, csvPath, dataRoot: join(directory, 'private'), assetRoot: join(directory, 'assets'), workingDirectory: directory, today: '2026-09-11' };
    const result = stageLicensedOwnership(options);
    const files = unzipSync(readFileSync(result.path));
    assert.deepEqual(Buffer.from(files['source.csv']), csv);
    const manifest = JSON.parse(strFromU8(files['manifest.json']));
    assert.equal(manifest.provider.licence.reference, profile.licence.reference);
    assert.equal(manifest.recordCount, 1);
    assert.equal(JSON.parse(strFromU8(files['candidates.json']))[0].status, 'candidate');
    assert.equal(result.caseChanges, 0);
    assert.equal(verifyLicensedArchive(result.path, '2026-09-11').integrity, 'verified');
    assert.equal(verifyLicensedArchive(result.path, '2026-10-01').licenceCurrentlyReady, false);
    const alteredPath = join(directory, 'altered.zip');
    writeFileSync(alteredPath, zipSync({ ...files, 'candidates.json': strToU8('[]') }));
    assert.throws(() => verifyLicensedArchive(alteredPath, '2026-09-11'), /do not match/);
    writeFileSync(alteredPath, zipSync({ ...files, '../unexpected': strToU8('bad') }));
    assert.throws(() => verifyLicensedArchive(alteredPath, '2026-09-11'), /Unexpected/);
    for (const folder of ['public', 'dist', 'build', '.git', 'node_modules', 'assets']) {
      assert.throws(() => stageLicensedOwnership({ ...options, dataRoot: join(directory, folder) }), /outside public/);
    }
    mkdirSync(join(directory, 'public'));
    symlinkSync(join(directory, 'public'), join(directory, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => stageLicensedOwnership({ ...options, dataRoot: join(directory, 'linked') }), /outside public/);
    writeFileSync(profilePath, JSON.stringify({ ...profile, enabled: false }));
    assert.throws(() => stageLicensedOwnership(options), /disabled/);
    assert.equal(readdirSync(join(directory, 'private', 'licensed-staging')).length, 1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('provider CLI reports unavailable connectors and suppresses input values on invalid configuration', () => {
  const directory = mkdtempSync(join(tmpdir(), 'licensed-cli-'));
  try {
    const path = join(directory, 'profile.json');
    const apiProfile = { ...profile, access: { mode: 'api', documentationUrl: 'https://example.invalid/docs', credentialEnv: ['FIELDWORK_PROVIDER_TEST_KEY'] } };
    writeFileSync(path, JSON.stringify(apiProfile));
    const result = spawnSync(process.execPath, ['apps/server/src/provider-cli.ts', 'check', path], { encoding: 'utf8', env: { ...process.env, FIELDWORK_PROVIDER_TEST_KEY: 'secret-sentinel' } });
    assert.equal(result.status, 2);
    assert.equal(JSON.parse(result.stdout).connector, 'not-implemented');
    assert.ok(!(result.stdout + result.stderr).includes('secret-sentinel'));
    writeFileSync(path, '{"password":"secret-sentinel", bad-json');
    const invalid = spawnSync(process.execPath, ['apps/server/src/provider-cli.ts', 'check', path], { encoding: 'utf8' });
    assert.equal(invalid.status, 1);
    assert.ok(!invalid.stderr.includes('secret-sentinel'));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});