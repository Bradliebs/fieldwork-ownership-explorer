import { z } from 'zod';

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const bounds = z.tuple([
  z.tuple([z.number().finite(), z.number().finite()]),
  z.tuple([z.number().finite(), z.number().finite()]),
]);
const releasePath = z.enum(['manifest.json', 'parcels.json', 'basemap.json', 'sales.json']);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const position = z.tuple([z.number().finite(), z.number().finite()]);

export const pilotManifestSchema = z.object({
  name: z.string().min(1),
  published: date,
  downloaded: z.string().datetime({ offset: true }),
  count: z.number().int().positive(),
  authorityCount: z.number().int().positive(),
  selection: bounds,
  selectionMethod: z.string().min(1),
  sourceUrl: z.string().url(),
  licence: z.string().url(),
  attribution: z.string().min(1),
  archiveSha256: sha256,
  gridSha256: sha256,
  transform: z.string().min(1),
  gridSource: z.string().url(),
  osm: z.object({
    source: z.string().url(),
    published: z.string().datetime({ offset: true }),
    sha256,
    licence: z.string().url(),
    attribution: z.string().min(1),
    bounds,
  }).strict(),
}).strict();

const parcelSchema = z.object({
  id: z.string().regex(/^INSPIRE-[0-9]+$/),
  label: z.string().min(1),
  geometry: z.object({
    type: z.literal('Polygon'),
    coordinates: z.array(z.array(position).min(4)).min(1),
  }).strict(),
  source: z.object({
    name: z.string().min(1),
    url: z.string().url(),
    published: date,
    inspireId: z.string().regex(/^[0-9]+$/),
  }).strict(),
  links: z.array(z.unknown()),
  revision: z.number().int().nonnegative(),
}).strict();

export const parcelDatasetSchema = z.object({
  parcels: z.array(parcelSchema).min(1),
  manifest: pilotManifestSchema,
}).strict();

const basemapPropertiesSchema = z.object({
  kind: z.string().min(1),
  name: z.string(),
  highway: z.string(),
}).strict();

export const basemapSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(z.object({
    type: z.literal('Feature'),
    id: z.union([z.string(), z.number()]).optional(),
    properties: basemapPropertiesSchema,
    geometry: z.union([
      z.object({ type: z.literal('LineString'), coordinates: z.array(position).min(2) }).strict(),
      z.object({ type: z.literal('Polygon'), coordinates: z.array(z.array(position).min(4)).min(1) }).strict(),
    ]),
  }).strict()),
}).strict();

export const salesReleaseSchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/),
  importedAt: z.string().datetime({ offset: true }),
  pilotSha256: sha256,
  sources: z.array(z.object({ url: z.string().url(), sha256 }).strict()).min(1),
  attribution: z.string().min(1),
  licence: z.string().url(),
  addressConditions: z.string().url(),
  records: z.array(z.object({
    transactionId: z.string().min(1),
    inspireIds: z.array(z.string().regex(/^[0-9]+$/)).min(1),
    price: z.number().int().positive(),
    date,
    address: z.string().min(1),
    propertyType: z.string().min(1),
    newBuild: z.boolean(),
    category: z.string().min(1),
  }).strict()),
}).strict();

export const releaseBundleSchema = z.object({
  releaseId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  schemaVersion: z.literal(1),
  createdAt: z.string().datetime({ offset: true }),
  importTool: z.object({ name: z.string().min(1), version: z.string().regex(/^\d+\.\d+\.\d+$/) }).strict(),
  sources: z.array(z.object({
    kind: z.enum(['parcels', 'basemap', 'sales']),
    period: z.string().min(1),
    urls: z.array(z.string().url()).min(1),
    licence: z.string().url(),
    attribution: z.string().min(1),
  }).strict()).length(3),
  files: z.array(z.object({
    path: releasePath,
    size: z.number().int().positive(),
    sha256,
  }).strict()).length(4),
  crs: z.object({
    source: z.literal('EPSG:27700'),
    display: z.literal('WGS84'),
    transform: z.string().min(1),
    grid: z.object({ url: z.string().url(), sha256 }).strict(),
  }).strict(),
  counts: z.object({
    parcels: z.number().int().positive(),
    basemapFeatures: z.number().int().nonnegative(),
    salesRecords: z.number().int().nonnegative(),
  }).strict(),
  bounds,
  compatibility: z.object({ salesRequiresParcelsSha256: sha256 }).strict(),
}).strict().superRefine((release, context) => {
  const paths = release.files.map(file => file.path);
  if (new Set(paths).size !== release.files.length || releasePath.options.some(path => !paths.includes(path))) {
    context.addIssue({ code: 'custom', message: 'Release must contain each required file exactly once' });
  }
  const sourceKinds = release.sources.map(source => source.kind);
  if (new Set(sourceKinds).size !== release.sources.length || ['parcels', 'basemap', 'sales'].some(kind => !sourceKinds.includes(kind as typeof sourceKinds[number]))) {
    context.addIssue({ code: 'custom', message: 'Release must describe parcel, basemap and sales sources' });
  }
  const parcelHash = release.files.find(file => file.path === 'parcels.json')?.sha256;
  if (release.compatibility.salesRequiresParcelsSha256 !== parcelHash) {
    context.addIssue({ code: 'custom', message: 'Sales compatibility must reference the release parcel hash' });
  }
  const [[west, south], [east, north]] = release.bounds;
  if (west >= east || south >= north) context.addIssue({ code: 'custom', message: 'Release bounds are invalid' });
});

export type ReleaseBundle = z.infer<typeof releaseBundleSchema>;
export type ReleaseFilePath = z.infer<typeof releasePath>;