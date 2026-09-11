import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

interface Migration {
  version: number;
  name: string;
  sql: string;
  checksum: string;
}

function migration(version: number, name: string, sql: string): Migration {
  const checksum = createHash('sha256').update(`${version}\0${name}\0${sql}`).digest('hex');
  return { version, name, sql, checksum };
}

const emptyWorkflowV2Json = '{"project":"","requester":"","replyAddress":"","retentionReviewOn":"","titles":[],"parties":[],"consents":[],"correspondence":[]}';
const migrations = [
  migration(1, 'investigations', `
    CREATE TABLE investigations (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, question TEXT NOT NULL, notes TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK(revision >= 0), created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL, snapshot TEXT NOT NULL
    );
    CREATE TABLE investigation_events (
      investigation_id TEXT NOT NULL REFERENCES investigations(id),
      revision INTEGER NOT NULL, action TEXT NOT NULL, at TEXT NOT NULL,
      name TEXT NOT NULL, question TEXT NOT NULL, notes TEXT NOT NULL,
      PRIMARY KEY(investigation_id, revision)
    );
  `),
  migration(2, 'consent-and-documents', `
    ALTER TABLE investigations ADD COLUMN workflow TEXT NOT NULL DEFAULT '${emptyWorkflowV2Json}';
    ALTER TABLE investigation_events ADD COLUMN workflow TEXT NOT NULL DEFAULT '${emptyWorkflowV2Json}';
    ALTER TABLE investigation_events ADD COLUMN documents TEXT NOT NULL DEFAULT '[]';
    CREATE TABLE investigation_documents (
      id TEXT PRIMARY KEY, investigation_id TEXT NOT NULL REFERENCES investigations(id),
      name TEXT NOT NULL, media_type TEXT NOT NULL, size INTEGER NOT NULL,
      sha256 TEXT NOT NULL, uploaded_at TEXT NOT NULL, content BLOB NOT NULL
    );
  `),
  migration(3, 'recovery-drafts', `
    CREATE TABLE recovery_drafts (
      id TEXT PRIMARY KEY, sequence INTEGER NOT NULL CHECK(sequence >= 0),
      payload TEXT, updated_at TEXT NOT NULL
    );
  `),
];

const migrationHistorySql = `CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL
)`;

export const investigationSchemaVersion = migrations.at(-1)!.version;

function hasTable(database: DatabaseSync, name: string): boolean {
  return Boolean(database.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?").get(name));
}

function tableSignature(database: DatabaseSync, table: string): string {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all();
  const foreignKeys = database.prepare(`PRAGMA foreign_key_list(${table})`).all();
  const indexes = database.prepare(`PRAGMA index_list(${table})`).all().map(row => ({
    ...row,
    columns: database.prepare(`PRAGMA index_info(${String(row.name)})`).all(),
  }));
  return JSON.stringify({ columns, foreignKeys, indexes });
}

function validateLegacySchema(database: DatabaseSync, version: number): void {
  if (version === 0) return;
  const tables = ['investigations', 'investigation_events', ...(version >= 2 ? ['investigation_documents'] : []), ...(version >= 3 ? ['recovery_drafts'] : [])];
  const reference = new DatabaseSync(':memory:');
  try {
    reference.exec('PRAGMA foreign_keys = ON');
    for (const item of migrations.filter(candidate => candidate.version <= version)) reference.exec(item.sql);
    for (const table of tables) {
      if (!hasTable(database, table) || tableSignature(database, table) !== tableSignature(reference, table)) {
        throw new Error('Investigation database schema does not match its version');
      }
    }
  } finally {
    reference.close();
  }
}

function validateMigrationHistorySchema(database: DatabaseSync): void {
  const reference = new DatabaseSync(':memory:');
  try {
    reference.exec(migrationHistorySql);
    if (tableSignature(database, 'schema_migrations') !== tableSignature(reference, 'schema_migrations')) {
      throw new Error('Investigation migration history schema is incompatible');
    }
  } finally {
    reference.close();
  }
}

export function checkInvestigationDatabase(database: DatabaseSync): void {
  const integrity = database.prepare('PRAGMA quick_check').all();
  if (integrity.length !== 1 || String(integrity[0].quick_check) !== 'ok') {
    throw new Error('Investigation database integrity check failed');
  }
  if (database.prepare('PRAGMA foreign_key_check').all().length) {
    throw new Error('Investigation database foreign key check failed');
  }
}

function createMigrationBackup(database: DatabaseSync, path: string, currentVersion: number): void {
  const backupPath = `${path}.pre-v${currentVersion}-to-v${investigationSchemaVersion}.${Date.now()}-${randomUUID()}.bak`;
  database.prepare('VACUUM INTO ?').run(backupPath);
  const backup = new DatabaseSync(backupPath, { readOnly: true });
  try {
    checkInvestigationDatabase(backup);
    if (Number(backup.prepare('PRAGMA user_version').get()!.user_version) !== currentVersion) {
      throw new Error('Investigation migration backup version mismatch');
    }
    validateLegacySchema(backup, currentVersion);
  } finally { backup.close(); }
}

export function migrateInvestigationDatabase(database: DatabaseSync, path: string): void {
  const currentVersion = Number(database.prepare('PRAGMA user_version').get()!.user_version);
  if (!Number.isInteger(currentVersion) || currentVersion < 0 || currentVersion > investigationSchemaVersion) {
    throw new Error('Unsupported investigation database version');
  }

  const hadMigrationHistory = hasTable(database, 'schema_migrations');
  validateLegacySchema(database, currentVersion);
  if (hadMigrationHistory) validateMigrationHistorySchema(database);

  const recorded = hadMigrationHistory
    ? database.prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version').all()
    : [];
  const expected = migrations.filter(item => item.version <= currentVersion);
  if (hadMigrationHistory && recorded.length !== expected.length) {
    throw new Error('Investigation migration history is incomplete');
  }
  for (const [index, row] of recorded.entries()) {
    const known = expected[index];
    if (!known || Number(row.version) !== known.version || known.name !== String(row.name) || known.checksum !== String(row.checksum)) {
      throw new Error('Investigation migration history is incompatible');
    }
  }

  if (currentVersion > 0 && currentVersion < investigationSchemaVersion && path !== ':memory:') {
    createMigrationBackup(database, path, currentVersion);
  }

  database.exec(hadMigrationHistory ? '' : migrationHistorySql);

  const record = database.prepare('INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)');
  if (!hadMigrationHistory) {
    for (const item of migrations.filter(candidate => candidate.version <= currentVersion)) {
      record.run(item.version, item.name, item.checksum, new Date().toISOString());
    }
  }

  for (const item of migrations.filter(candidate => candidate.version > currentVersion)) {
    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec(item.sql);
      database.exec(`PRAGMA user_version = ${item.version}`);
      record.run(item.version, item.name, item.checksum, new Date().toISOString());
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
}