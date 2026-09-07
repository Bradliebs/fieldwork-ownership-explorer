import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Investigation, InvestigationEdit, InvestigationEvent, InvestigationSnapshot, InvestigationSummary } from '../../../packages/contracts/src/investigation.ts';
import { emptyWorkflow, workflowSchema, validateDocumentReferences, type EvidenceDocument } from '../../../packages/contracts/src/consent.ts';

export function createInvestigationStore(path = ':memory:') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  try {
    database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
    const version = database.prepare('PRAGMA user_version').get()!.user_version;
    if (version !== 0 && version !== 1 && version !== 2) throw new Error('Unsupported investigation database version');
    if (version === 0) database.exec(`
      BEGIN IMMEDIATE;
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
      PRAGMA user_version = 1;
      COMMIT;
    `);
    if (version === 1 && path !== ':memory:' && !existsSync(`${path}.pre-consent-v2.bak`)) database.prepare('VACUUM INTO ?').run(`${path}.pre-consent-v2.bak`);
    if (version !== 2) database.exec(`
      BEGIN IMMEDIATE;
      ALTER TABLE investigations ADD COLUMN workflow TEXT NOT NULL DEFAULT '${JSON.stringify(emptyWorkflow())}';
      ALTER TABLE investigation_events ADD COLUMN workflow TEXT NOT NULL DEFAULT '${JSON.stringify(emptyWorkflow())}';
      ALTER TABLE investigation_events ADD COLUMN documents TEXT NOT NULL DEFAULT '[]';
      CREATE TABLE investigation_documents (
        id TEXT PRIMARY KEY, investigation_id TEXT NOT NULL REFERENCES investigations(id),
        name TEXT NOT NULL, media_type TEXT NOT NULL, size INTEGER NOT NULL,
        sha256 TEXT NOT NULL, uploaded_at TEXT NOT NULL, content BLOB NOT NULL
      );
      PRAGMA user_version = 2;
      COMMIT;
    `);
  } catch (error) { database.close(); throw error; }

  function get(id: string): Investigation | undefined {
    const row = database.prepare('SELECT * FROM investigations WHERE id = ?').get(id);
    if (!row) return undefined;
    return { id: String(row.id), name: String(row.name), question: String(row.question), notes: String(row.notes),
      revision: Number(row.revision), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
      snapshot: JSON.parse(String(row.snapshot)) as InvestigationSnapshot,
      workflow: workflowSchema.parse(JSON.parse(String(row.workflow))), documents: documents(id) };
  }
  function documents(id: string): EvidenceDocument[] {
    return database.prepare('SELECT id, name, media_type, size, sha256, uploaded_at FROM investigation_documents WHERE investigation_id = ? ORDER BY uploaded_at, id').all(id)
      .map(row => ({ id: String(row.id), name: String(row.name), mediaType: String(row.media_type), size: Number(row.size), sha256: String(row.sha256), uploadedAt: String(row.uploaded_at) }));
  }
  function transaction<Value>(operation: () => Value): Value {
    database.exec('BEGIN IMMEDIATE');
    try { const value = operation(); database.exec('COMMIT'); return value; }
    catch (error) { database.exec('ROLLBACK'); throw error; }
  }
  function audit(item: Investigation, action: InvestigationEvent['action']) {
    database.prepare('INSERT INTO investigation_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(item.id, item.revision, action, item.updatedAt, item.name, item.question, item.notes, JSON.stringify(item.workflow), JSON.stringify(item.documents));
  }
  return {
    get,
    list(): InvestigationSummary[] {
      return database.prepare(`SELECT id, name, revision, updated_at,
        json_extract(snapshot, '$.parcel.id') AS parcel_id FROM investigations ORDER BY updated_at DESC, id`).all()
        .map(row => ({ id: String(row.id), name: String(row.name), parcelId: String(row.parcel_id),
          updatedAt: String(row.updated_at), revision: Number(row.revision) }));
    },
    history(id: string): InvestigationEvent[] {
      return database.prepare('SELECT revision, action, at FROM investigation_events WHERE investigation_id = ? ORDER BY revision DESC').all(id)
        .map(row => ({ revision: Number(row.revision), action: row.action as InvestigationEvent['action'], at: String(row.at) }));
    },
    create(edit: InvestigationEdit, snapshot: InvestigationSnapshot, id: string = randomUUID()): Investigation {
      return transaction(() => {
        const workflow = workflowSchema.parse(edit.workflow ?? emptyWorkflow());
        validateDocumentReferences(workflow, []);
        const existing = get(id);
        if (existing) {
          if (existing.name !== edit.name || existing.question !== edit.question || existing.notes !== edit.notes ||
            JSON.stringify(existing.workflow) !== JSON.stringify(workflow) ||
            JSON.stringify(existing.snapshot) !== JSON.stringify(snapshot)) throw new Error('Creation conflict');
          return existing;
        }
        const at = new Date().toISOString();
        const item: Investigation = { ...edit, workflow, documents: [], id, snapshot: structuredClone(snapshot), revision: 0, createdAt: at, updatedAt: at };
        database.prepare('INSERT INTO investigations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(item.id, item.name, item.question, item.notes, item.revision, at, at, JSON.stringify(item.snapshot), JSON.stringify(workflow));
        audit(item, 'created');
        return item;
      });
    },
    update(id: string, revision: number, edit: InvestigationEdit): Investigation {
      return transaction(() => {
        const previous = get(id);
        if (!previous) throw new Error('Investigation not found');
        if (previous.revision !== revision) throw new Error('Revision conflict');
        const workflow = workflowSchema.parse(edit.workflow ?? previous.workflow);
        validateDocumentReferences(workflow, previous.documents);
        const item = { ...previous, ...edit, workflow, revision: revision + 1, updatedAt: new Date().toISOString() };
        database.prepare('UPDATE investigations SET name = ?, question = ?, notes = ?, revision = ?, updated_at = ?, workflow = ? WHERE id = ?')
          .run(item.name, item.question, item.notes, item.revision, item.updatedAt, JSON.stringify(workflow), id);
        audit(item, 'updated');
        return item;
      });
    },
    addDocument(id: string, revision: number, name: string, mediaType: string, content: Buffer): Investigation {
      return transaction(() => {
        const item = get(id);
        if (!item) throw new Error('Investigation not found');
        if (item.revision !== revision) throw new Error('Revision conflict');
        if (item.documents.length >= 50) throw new Error('At most 50 documents per investigation');
        if (!name.trim() || name.length > 160 || /[\x00-\x1f\\/]/.test(name) || content.length === 0 || content.length > 3_000_000) throw new Error('Invalid document name or size (maximum 3 MB)');
        const valid = mediaType === 'application/pdf' ? content.subarray(0, 5).toString() === '%PDF-'
          : mediaType === 'image/png' ? content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          : mediaType === 'image/jpeg' ? content[0] === 255 && content[1] === 216 && content[2] === 255
          : mediaType === 'text/plain' && !content.includes(0);
        if (!valid) throw new Error('Only PDF, PNG, JPEG or plain text evidence is accepted');
        const document: EvidenceDocument = { id: randomUUID(), name, mediaType, size: content.length, sha256: createHash('sha256').update(content).digest('hex'), uploadedAt: new Date().toISOString() };
        database.prepare('INSERT INTO investigation_documents VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(document.id, id, name, mediaType, content.length, document.sha256, document.uploadedAt, content);
        item.documents.push(document); item.revision++; item.updatedAt = document.uploadedAt;
        database.prepare('UPDATE investigations SET revision = ?, updated_at = ? WHERE id = ?').run(item.revision, item.updatedAt, id);
        audit(item, 'document added');
        return item;
      });
    },
    document(id: string, documentId: string) {
      const row = database.prepare('SELECT content FROM investigation_documents WHERE investigation_id = ? AND id = ?').get(id, documentId);
      const metadata = documents(id).find(document => document.id === documentId);
      return row && metadata ? { metadata, content: Buffer.from(row.content as Uint8Array) } : undefined;
    },
    close: () => database.close(),
  };
}