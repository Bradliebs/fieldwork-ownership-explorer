import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Investigation, InvestigationEdit, InvestigationEvent, InvestigationSnapshot, InvestigationSummary, RecoveryDraft } from '../../../packages/contracts/src/investigation.ts';
import { draftWorkflowSchema, emptyWorkflow, workflowSchema, validateDocumentReferences, validateParcelScope, validateLifecycleChange, type EvidenceDocument } from '../../../packages/contracts/src/consent.ts';
import { checkInvestigationDatabase, migrateInvestigationDatabase } from './investigation-migrations.ts';

export function createInvestigationStore(path = ':memory:') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  try {
    database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
    checkInvestigationDatabase(database);
    migrateInvestigationDatabase(database, path);
    checkInvestigationDatabase(database);
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
    database.prepare(`INSERT INTO investigation_events (
      investigation_id, revision, action, at, name, question, notes, workflow, documents
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(item.id, item.revision, action, item.updatedAt, item.name, item.question, item.notes, JSON.stringify(item.workflow), JSON.stringify(item.documents));
  }
  return {
    get,
    drafts(): RecoveryDraft[] {
      return database.prepare('SELECT payload FROM recovery_drafts WHERE payload IS NOT NULL ORDER BY updated_at DESC, id').all()
        .map(row => JSON.parse(String(row.payload)) as RecoveryDraft);
    },
    checkpoint(draft: Omit<RecoveryDraft, 'updatedAt'>): RecoveryDraft {
      return transaction(() => {
        const row = database.prepare('SELECT sequence, payload FROM recovery_drafts WHERE id = ?').get(draft.id);
        if (row && row.payload === null) throw new Error('Draft closed');
        if (row && Number(row.sequence) >= draft.sequence) throw new Error('Draft sequence conflict');
        const previous = row ? JSON.parse(String(row.payload)) as RecoveryDraft : undefined;
        if (previous && (previous.operationId !== draft.operationId || previous.investigationId !== draft.investigationId || previous.baseRevision !== draft.baseRevision)) throw new Error('Draft identity conflict');
        if (!row && Number(database.prepare('SELECT count(*) AS total FROM recovery_drafts WHERE payload IS NOT NULL').get()!.total) >= 100) throw new Error('At most 100 recovery drafts');
        const item: RecoveryDraft = { ...draft, snapshot: previous?.snapshot ?? draft.snapshot,
          edit: { ...draft.edit, workflow: draftWorkflowSchema.parse(draft.edit.workflow ?? emptyWorkflow()) }, updatedAt: new Date().toISOString() };
        database.prepare('INSERT INTO recovery_drafts (id, sequence, payload, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET sequence = excluded.sequence, payload = excluded.payload, updated_at = excluded.updated_at')
          .run(item.id, item.sequence, JSON.stringify(item), item.updatedAt);
        return item;
      });
    },
    closeDraft(id: string) {
      database.prepare('INSERT INTO recovery_drafts (id, sequence, payload, updated_at) VALUES (?, 0, NULL, ?) ON CONFLICT(id) DO UPDATE SET payload = NULL, updated_at = excluded.updated_at')
        .run(id, new Date().toISOString());
    },
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
    revision(id: string, revision: number): Investigation | undefined {
      const current = get(id);
      if (!current) return undefined;
      const row = database.prepare('SELECT * FROM investigation_events WHERE investigation_id = ? AND revision = ?').get(id, revision);
      if (!row) return undefined;
      return { ...current, revision, name: String(row.name), question: String(row.question), notes: String(row.notes), updatedAt: String(row.at),
        workflow: JSON.parse(String(row.workflow)), documents: JSON.parse(String(row.documents)) };
    },
    create(edit: InvestigationEdit, snapshot: InvestigationSnapshot, id: string = randomUUID()): Investigation {
      return transaction(() => {
        const workflow = workflowSchema.parse(edit.workflow ?? emptyWorkflow());
        validateDocumentReferences(workflow, []);
        validateParcelScope(workflow, (snapshot.parcels ?? [snapshot.parcel]).map(parcel => parcel.id));
        const existing = get(id);
        if (existing) {
          if (existing.name !== edit.name || existing.question !== edit.question || existing.notes !== edit.notes ||
            JSON.stringify(existing.workflow) !== JSON.stringify(workflow) ||
            JSON.stringify(existing.snapshot) !== JSON.stringify(snapshot)) throw new Error('Creation conflict');
          return existing;
        }
        const at = new Date().toISOString();
        const item: Investigation = { ...edit, workflow, documents: [], id, snapshot: structuredClone(snapshot), revision: 0, createdAt: at, updatedAt: at };
        database.prepare(`INSERT INTO investigations (
          id, name, question, notes, revision, created_at, updated_at, snapshot, workflow
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
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
        validateLifecycleChange(previous.workflow, workflow);
        if (previous.workflow.lifecycle?.state === 'archived') {
          const { lifecycle: previousLifecycle, retentionReviewOn: previousReview, ...previousFields } = previous.workflow;
          const { lifecycle: nextLifecycle, retentionReviewOn: nextReview, ...nextFields } = workflow;
          if (previous.name !== edit.name || previous.question !== edit.question || previous.notes !== edit.notes || JSON.stringify(previousFields) !== JSON.stringify(nextFields)) throw new Error('Lifecycle archived case is read-only. Reopen it in a separate saved decision before editing.');
        }
        validateDocumentReferences(workflow, previous.documents);
        validateParcelScope(workflow, (previous.snapshot.parcels ?? [previous.snapshot.parcel]).map(parcel => parcel.id));
        const item = { ...previous, ...edit, workflow, revision: revision + 1, updatedAt: new Date().toISOString() };
        database.prepare('UPDATE investigations SET name = ?, question = ?, notes = ?, revision = ?, updated_at = ?, workflow = ? WHERE id = ?')
          .run(item.name, item.question, item.notes, item.revision, item.updatedAt, JSON.stringify(workflow), id);
        audit(item, 'updated');
        return item;
      });
    },
    addDocument(id: string, revision: number, name: string, mediaType: string, content: Buffer, allowDuplicate = false): Investigation {
      return transaction(() => {
        const item = get(id);
        if (!item) throw new Error('Investigation not found');
        if (item.revision !== revision) throw new Error('Revision conflict');
        if (item.workflow.lifecycle?.state === 'archived') throw new Error('Lifecycle archived case cannot accept documents. Reopen it first.');
        if (item.documents.length >= 50) throw new Error('At most 50 documents per investigation');
        if (!name.trim() || name.length > 160 || /[\x00-\x1f\\/]/.test(name) || content.length === 0 || content.length > 3_000_000) throw new Error('Invalid document name or size (maximum 3 MB)');
        const valid = mediaType === 'application/pdf' ? content.subarray(0, 5).toString() === '%PDF-'
          : mediaType === 'image/png' ? content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          : mediaType === 'image/jpeg' ? content[0] === 255 && content[1] === 216 && content[2] === 255
          : mediaType === 'text/plain' && !content.includes(0);
        if (!valid) throw new Error('Only PDF, PNG, JPEG or plain text evidence is accepted');
        const document: EvidenceDocument = { id: randomUUID(), name, mediaType, size: content.length, sha256: createHash('sha256').update(content).digest('hex'), uploadedAt: new Date().toISOString() };
        if (!allowDuplicate && item.documents.some(existing => existing.sha256 === document.sha256)) throw new Error('Duplicate document content is already attached. Confirm before retaining another copy.');
        database.prepare(`INSERT INTO investigation_documents (
          id, investigation_id, name, media_type, size, sha256, uploaded_at, content
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(document.id, id, name, mediaType, content.length, document.sha256, document.uploadedAt, content);
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