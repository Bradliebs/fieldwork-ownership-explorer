import { z } from 'zod';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Expected a real calendar date');
const text = z.string().trim().min(1).max(500);
const referenceUrl = z.string().url().refine(value => {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;
}, 'Use an HTTPS reference URL without credentials, query parameters or fragments');

export const licensedProviderSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  provider: text,
  product: text,
  service: z.enum(['ownership', 'planning', 'signatures']),
  enabled: z.boolean(),
  access: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('manual-file') }).strict(),
    z.object({ mode: z.literal('api'), documentationUrl: referenceUrl,
      credentialEnv: z.array(z.string().regex(/^FIELDWORK_PROVIDER_[A-Z][A-Z0-9_]{0,100}$/)).min(1).max(10)
        .refine(values => new Set(values).size === values.length, 'Duplicate credential reference'),
    }).strict(),
  ]),
  licence: z.object({
    reference: text, termsUrl: referenceUrl, approvedBy: z.string().trim().max(200),
    approvedOn: date.nullable(), validFrom: date, validUntil: date,
    purpose: text, coverage: text,
    permissions: z.object({ localStorage: z.boolean(), backup: z.boolean(), ownershipResearch: z.boolean(),
      derivedExport: z.boolean(), commercialContact: z.boolean() }).strict(),
  }).strict(),
}).strict().superRefine((profile, context) => {
  if (profile.licence.validUntil < profile.licence.validFrom) context.addIssue({ code: 'custom', message: 'Licence end precedes start' });
});

export type LicensedProvider = z.infer<typeof licensedProviderSchema>;

export function providerReadiness(profile: LicensedProvider, today = new Date().toISOString().slice(0, 10), environment: Record<string, string | undefined> = {}) {
  date.parse(today);
  const blockers: string[] = [];
  if (!profile.enabled) blockers.push('Provider is disabled');
  if (!profile.licence.approvedBy || !profile.licence.approvedOn) blockers.push('Licence review is not recorded');
  if (profile.licence.approvedOn && profile.licence.approvedOn > today) blockers.push('Licence review date is in the future');
  if (today < profile.licence.validFrom) blockers.push('Licence has not started');
  if (today > profile.licence.validUntil) blockers.push('Licence has expired');
  if (profile.service === 'ownership' && profile.access.mode === 'manual-file' &&
    (!profile.licence.permissions.localStorage || !profile.licence.permissions.backup || !profile.licence.permissions.ownershipResearch)) {
    blockers.push('Ownership intake requires approved local storage, backup and ownership research permissions');
  }
  const credentials = profile.access.mode === 'api' ? profile.access.credentialEnv.map(name => ({ name, configured: Boolean(environment[name]?.trim()) })) : [];
  const connector = profile.access.mode === 'manual-file' && profile.service === 'ownership' ? 'ownership-csv' : 'not-implemented';
  return { id: profile.id, service: profile.service, mode: profile.access.mode, blockers, credentials,
    connector, ready: blockers.length === 0 && connector === 'ownership-csv',
    networkEnabled: false as const };
}

export function assertOwnershipIntakeAllowed(profile: LicensedProvider, today: string) {
  const readiness = providerReadiness(profile, today);
  if (profile.service !== 'ownership' || profile.access.mode !== 'manual-file') throw new Error('This intake supports manual ownership CSV only; no API adapter is active');
  if (readiness.blockers.length) throw new Error(readiness.blockers.join('; '));
}