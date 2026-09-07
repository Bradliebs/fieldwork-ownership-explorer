---
title: Fieldwork Ownership Explorer
description: Local Bristol INSPIRE parcel pilot with offline geographic context and an isolated synthetic ownership-review demo.
---

## Current implementation

Fieldwork runs on a Windows PC in a browser alongside ArcGIS Pro. The default
workspace shows 1,456 real INSPIRE polygons around Bristol Harbourside, extracted
from the Bristol release published on 6 September 2026. Ownership is unknown for
every real parcel. These are indicative freehold extents, not legal boundaries.
The workspace selector also offers an isolated 12-parcel synthetic review demo.

Implemented: interactive map, parcel/owner/title search, match and interest filters,
evidence panel, joint proprietors in the demo, review queue, source register and
source-aware GeoJSON export. Synthetic review decisions survive restart in a local
append-only journal. Real parcels cannot inherit those reviews. Real-data search
currently supports INSPIRE IDs, not addresses or owners that have not been loaded.
The local OpenStreetMap extract supplies roads, buildings, water and parks.
Map layers and fonts work without external network requests after installation.

## Pilot data and limitations

The checked-in `public/pilot` assets include separate parcel and basemap data plus
a source manifest with release dates, input checksums, licences and attribution.
The selection retains whole polygons whose BNG bounding boxes overlap the pilot
envelope. It is not a complete Bristol or national dataset. Basemap coverage is
also bounded; panning outside the extract will show missing context.

The importer uses SAX XML parsing, Proj4js and the OS OSTN15 transformation grid.
EPSG:27700 coordinates are transformed to ETRS89 and displayed as WGS84 for web
mapping. This is not a survey-grade epoch-aware WGS84 conversion. Source geometry
is not simplified or clipped, and interior rings are retained. GDAL/ArcGIS Pro
acceptance and independent survey-control validation remain pending.

To regenerate, obtain the Bristol ZIP from the official INSPIRE download page,
an OSM Overpass JSON extract with geometry, and the grid linked in the manifest.
Run from the repository root before rebuilding; do not refresh while serving:

```powershell
node --import tsx import-pilot.ts <Bristol.zip> <osm.json> <OSTN15.tif>
npm run build
```

The importer is specific to the inspected GML schema, not a general national
ingestion pipeline. It rejects unsupported CRS, malformed rings, duplicate IDs
and count mismatches. It writes files individually, not a transactional release.
Retain raw downloads separately if reproducibility across future source releases
is required. The current downloads are in the Windows temporary directory.

INSPIRE is used under the OGL and HMLR/OS conditions. OpenStreetMap context is a
separate ODbL database extract; its downloadable GeoJSON is at
`public/pilot/basemap.json`. No public raster tiles were bulk downloaded.
The OS OSTN15 grid is distributed by PROJ under BSD-2-Clause and is not bundled.
The OSM converter's XML dependency is overridden to patched version 0.9.12; this
importer uses its JSON path, which is exercised by the real-data import.

## Run locally

Requires Node.js 24 or later. From the workspace root:

```powershell
npm ci
npm run build
npm run dev
```

Open <http://127.0.0.1:4317>. Use this exact loopback address: the API rejects other
Host and Origin values. The launcher serves the built frontend; rebuild after UI
changes. Set the PORT environment variable to an unused port if needed.

The app does not expose itself to the LAN. It uses the Windows account as its
local access boundary, checks Host/Origin, and requires a random per-launch token
for writes. Reviewer names are audit labels, not authenticated team identities.

## Review and export semantics

* A review changes only the review decision, never match status or interest.
* Verified fixture links require documentary, whole-parcel evidence for the same interest.
* Address and overlap evidence remain inferred, even after review.
* Rejected links remain in evidence history but do not contribute to the active parcel summary.
* Unmatched means unknown, not private or unregistered ownership.
* Pilot exports contain real geometry, source IDs, provenance and unknown ownership.
   Demo exports remain explicitly synthetic. Neither is the planned normalized
   GeoPackage delivery; ArcGIS compatibility has not been verified.

The demo journal is stored under the ignored `.local` directory. Back it up before
changing fixture identifiers. A corrupt or incompatible journal stops startup
rather than discarding reviews. Do not edit it while the server is running.
This small synchronous journal is for the synthetic preview, not the national
database; production persistence will use PostgreSQL transactions and migrations.

## Verification

```powershell
npm test
npm run typecheck
npm run build
npx playwright install chromium
npm run test:e2e
```

Browser tests start an isolated server on port 4318 with temporary synthetic
review storage. They verify rendered parcel pixels, search, persistent reviews,
joint proprietors, downloads and 1440x900/390x844 layouts. Pilot tests independently
check water pixels, parcel-layer changes, offline requests, source metadata and
dataset isolation. Test output is ignored.

## Remaining delivery gates

1. Confirm source-specific licence acceptance, permitted use, attribution and
   export recipients before importing restricted ownership data. CCOD prohibits direct marketing.
2. Configure native PostgreSQL/PostGIS and GDAL, validate source CRS transforms,
   and test a sample GeoPackage in David's installed ArcGIS Pro.
3. Implement normalized release-aware persistence, source adapters, staged atomic
   imports, cross-authority deduplication and data lifecycle handling.
4. Add evidence-led candidate matching, wider basemap coverage and indexed
   viewport tiles. The bounded pilot uses GeoJSON, not a national serving strategy.
5. Validate a real authority pilot, backup/restore, licence revocation and hardware
   performance before national rollout. No national matching coverage is promised.

Private individual ownership, paid title links, public hosting and remote team
access remain outside scope. Corporate-data ingestion and GeoPackage controls are
not shown as working features in this preview.