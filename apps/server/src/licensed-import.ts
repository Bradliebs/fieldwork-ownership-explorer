import { createHash } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { assertOwnershipIntakeAllowed, licensedProviderSchema, type LicensedProvider } from '../../../packages/contracts/src/licensed-provider.ts';

const column = z.string().trim().min(1).max(200);
export const ownershipMappingSchema = z.object({
  recordId: column, titleNumber: column, proprietor: column, sourceDate: column, evidenceReference: column,
  inspireId: column.optional(),
}).strict().refine(mapping => new Set(Object.values(mapping)).size === Object.values(mapping).length, 'Column mappings must be distinct');
export type OwnershipMapping = z.infer<typeof ownershipMappingSchema>;
const sourceRecordSchema = z.object({
  recordId: z.string().trim().min(1).max(200), titleNumber: z.string().trim().min(1).max(100),
  proprietor: z.string().trim().min(1).max(500), evidenceReference: z.string().trim().min(1).max(1000),
  sourceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }),
  inspireId: z.string().regex(/^\d{1,9}$/).optional(),
});
const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

export function prepareOwnershipImport(input: Buffer, rawProfile: LicensedProvider, rawMapping: OwnershipMapping, today = new Date().toISOString().slice(0, 10)) {
  const profile = licensedProviderSchema.parse(rawProfile);
  const mapping = ownershipMappingSchema.parse(rawMapping);
  assertOwnershipIntakeAllowed(profile, today);
  if (!input.length || input.length > 10_000_000) throw new Error('CSV must contain between 1 byte and 10 MB');
  let rows: string[][];
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(input);
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) throw new Error('Control character');
    rows = parse(text, { bom: true, skip_empty_lines: true, max_record_size: 50_000, to: 10_002 });
  } catch { throw new Error('CSV is not valid bounded UTF-8 data'); }
  const [headers, ...data] = rows;
  if (!headers || !data.length || data.length > 10_000) throw new Error('CSV must have a header and between 1 and 10000 records');
  if (new Set(headers).size !== headers.length || headers.some(header => !header.trim())) throw new Error('CSV headers must be nonempty and unique');
  if (Object.values(mapping).some(name => !headers.includes(name))) throw new Error('Mapped column is missing from CSV');
  const ids = new Set<string>();
  const records = data.map((row, index) => {
    const fields = Object.fromEntries(Object.entries(mapping).map(([field, name]) => [field, row[headers.indexOf(name)]]));
    if (fields.inspireId === '') delete fields.inspireId;
    const parsed = sourceRecordSchema.safeParse(fields);
    if (!parsed.success || parsed.data.sourceDate > today) throw new Error(`Invalid ownership record at CSV row ${index + 2}`);
    if (ids.has(parsed.data.recordId)) throw new Error(`Duplicate provider record identifier at CSV row ${index + 2}`);
    ids.add(parsed.data.recordId);
    return { ...parsed.data, status: 'candidate' as const, relationship: 'unconfirmed' as const, contactUse: 'unconfirmed' as const };
  });
  return {
    schemaVersion: 1 as const, kind: 'licensed-ownership-staging' as const, provider: profile, mapping,
    sourceSha256: sha256(input), profileSha256: sha256(JSON.stringify(profile)), mappingSha256: sha256(JSON.stringify(mapping)),
    preparedOn: today, records,
    notice: 'Unverified provider assertions. INSPIRE identifiers do not establish title extent. No parcel ownership, case checks or contact approvals have changed.',
  };
}