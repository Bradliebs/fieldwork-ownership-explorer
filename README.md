---
title: Fieldwork Ownership Explorer
description: Local Bristol landowner contact and construction consent cases with source snapshots, private evidence and printable requests and reports.
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

## Recorded sales

Enable Recorded sales only in Explore to find the four pilot parcels linked to
four transactions in HMLR's July 2026 publication. The Recorded sales section
shows the transaction price, sale date, address, property type and identifiers.
July is the publication/update period, not the sale month: this extract includes
sales dated 2015, 2018 and 2026. It is not a complete historical sale register.

The join uses the official transaction-to-INSPIRE lookup, not address matching or
geocoding. Original parcel geometry and ownership links are unchanged. A price
belongs to a transaction and must not be allocated to each associated polygon.
Sale records do not identify the current owner or establish a title number.
No match means no linked record in this release, not that a property never sold.

The generated [public/pilot/sales.json](public/pilot/sales.json) records source
URLs, SHA-256 checksums, attribution and the pilot file checksum. It is included
in the build. New investigations capture the relevant sale evidence and source
metadata; existing investigations are not backfilled. Reports and parcel GeoJSON
exports include the captured or current sale evidence, respectively, separately
from ownership. Synthetic records never receive it.

The lookup is OGL-licensed. Price Paid address fields have separate conditions;
retain attribution and review permitted use before redistributing exports.
Do not use Price Paid addresses as a commercial landowner contact list. The app
never copies these addresses into party contact records:

* [INSPIRE lookup and terms](https://www.gov.uk/government/statistical-data-sets/transaction-unique-identifier-and-inspire-id-look-up-table-dataset)
* [Price Paid Data conditions](https://www.gov.uk/government/statistical-data-sets/price-paid-data-downloads#using-or-publishing-our-price-paid-data)

To regenerate this July-only extract, stop the server and run:

```powershell
node --import tsx import-sales.ts
npm run build
npm run dev
```

The importer downloads official CSVs and archives them by checksum under
`.local/sales-inputs`. It validates identifiers, preserves multi-polygon
transactions, uses changed records and excludes deletions. Missing linked
transactions or conflicting rows stop the import before replacing the extract.
The rolling Price Paid URL is guarded by checking HMLR's current release page;
once it advances beyond July 2026, this importer refuses to run. Later monthly
releases need a versioned import workflow, not relabelling this extract.
Changing the pilot file invalidates its sales extract and requires reimport.
There are no runtime external requests, paid calls, UPRN imports or corporate
ownership matching in this milestone.

## Saved investigations

1. Select a real Bristol parcel in Explore and choose Start investigation.
2. Enter an investigation name, question and analyst notes, then Save investigation.
3. Reopen saved work from Investigations, including after restarting the server.
4. Choose Report after saving, then Print / Save as PDF in the report window.

Each investigation currently holds one parcel. Creation captures the authoritative
server parcel, source manifest and release checksum. Later edits preserve that
snapshot; refreshing the pilot does not rewrite existing investigations. Saves
and their audit entries share a SQLite transaction. Revision conflicts reject
stale edits without overwriting saved work, and the editor retains the unsaved
draft. Retrying an identical creation request with the same operation ID returns
the existing record rather than creating a duplicate.

Reports use the latest saved revision, not unsaved text. They contain a north-up
parcel outline, source facts, analyst notes, title assessments, relevant parties,
correspondence, consent decisions and evidence references. The outline has no
basemap or survey scale. INSPIRE IDs are not title numbers. Case assessments do
not change the source parcel's unknown ownership status or its exported links.
Synthetic parcels cannot create investigations. There is no automated owner
lookup, automatic title linking or multi-parcel case support.

## Construction consent workflow

1. Start an investigation from the relevant real parcel. In Project, record the
   project, requesting company/contact, reply details and retention review date.
2. Obtain current title register and plan evidence through an authorised source,
   such as [HM Land Registry's property information service](https://www.gov.uk/search-property-information-land-registry).
   In Titles, record each title number, tenure, evidence reference/date and its
   relationship to the parcel. A checked assessment requires a named reviewer,
   review date and extent assessment. An INSPIRE outline alone is not enough.
3. In Parties, record the relevant proprietor, leaseholder, occupier or agent and
   related title. Record where their contact details came from, the permitted-use
   assessment and check date before approving commercial contact use. Separately
   record evidence of authority to give the requested permission.
4. In Requests, name the party, proposed activities, exact land scope/plan,
   proposed dates and conditions. Save, then choose Request draft to print or
   save an unsent letter as PDF. Include the referenced scope plan when sending.
5. Send the request outside the application. Only then record its sent date and
   awaiting-response status. Log emails, letters, calls and meetings in
   Correspondence, with source references where available.
6. Upload the response and supporting evidence in Documents after saving the
   case. Use the displayed `doc:<id>` reference in the relevant evidence field,
   or record a reference to your controlled document-management system.
7. Record the decision, response date, signatory, scope, validity and conditions.
   Granted consent requires a checked title covering all or part of the parcel,
   authority evidence with a reviewer/date, and response evidence. Refusals and
   revocations also require response evidence. The display distinguishes future,
   currently effective and expired grants without overwriting the saved decision.
8. Save and generate the case Report. Confirm all relevant interests, permissions
   and conditions before any access or works; one recorded grant is not a
   clearance to start work.

These are team-entered assessments, not independent ownership verification or
legal advice. The app cannot determine whether a document establishes authority,
whether every rights-holder has been identified, or whether a consent is legally
sufficient. It does not send correspondence, collect signatures or obtain consent.
Request drafts are marked DRAFT / NOT SENT and do not change request status.
Reports contain confidential contact details and should have controlled recipients.

Documents accept PDF, PNG, JPEG or plain text, up to 3 MB each and 50 per case.
They are stored in SQLite, not the public asset directory, with a SHA-256 checksum
and upload date. Downloads are case-scoped, attachment-only and not cached. Basic
file-type checks are not malware scanning; inspect files through your company's
approved security process. There is no document preview or deletion control.
Removed workflow records remain in the database audit history. The on-screen
history lists revision, action and date, not a full historical-record viewer.

Local investigations are stored in `.local/investigations.sqlite` using Node's
built-in SQLite API. Node 24.13.1 emits an experimental SQLite warning. The database
contains saved geometry, manifests, notes, contact and consent records, uploaded
documents and edit history; it is not encrypted.
Keep this local workspace and any reports within your intended access boundary.

The first upgrade from the earlier investigation database creates
`.local/investigations.sqlite.pre-consent-v2.bak` before a transactional schema
migration. Existing notes, revisions and source snapshots are preserved; older
cases receive an empty consent workflow. Migration and reopening the pre-upgrade
backup are covered by automated tests. This one-time backup is not ongoing backup
protection.

For a manual backup, stop the app and copy the entire `.local` directory to a
separate protected location. Retain the matching application and pilot assets as
well. Never replace a database while the app is running. Scheduled backups,
operational restore drills, archival and deletion controls remain pending.
The retention review date is a recorded field, not a reminder or deletion job.

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
This small synchronous journal is for the synthetic preview. Real investigations
use a separate local SQLite database. PostgreSQL/PostGIS is deferred until a
larger serving or collaboration requirement justifies it.

## Verification

```powershell
npm test
npm run typecheck
npm run build
npx playwright install chromium
npm run test:e2e
```

Browser tests start an isolated server on port 4318 with temporary synthetic
review storage and a temporary investigation database. They verify rendered parcel pixels, search, persistent reviews,
joint proprietors, downloads and 1440x900/390x844 layouts. Pilot tests independently
check water pixels, parcel-layer changes, offline requests, source metadata and
dataset isolation. Investigation tests cover save/reopen, stale edits, escaped
reports, PDF generation and synthetic-data isolation. Store/API tests check
restart persistence, retry-safe creation and rollback when audit writes fail.
Consent tests cover required evidence, authority, contact-use approval, date
validation, migration/backup reopening, private document access, revision
conflicts, unsent request drafts and the complete desktop/mobile case journey.
Test output is ignored.

## Remaining delivery gates

1. Confirm source-specific licence acceptance, permitted use, attribution and
   export recipients before importing restricted ownership data. CCOD prohibits direct marketing.
2. Add multi-parcel investigations if required. Validate source CRS transforms and test
   a sample GeoPackage in David's installed ArcGIS Pro before claiming compatibility.
3. Implement normalized release-aware persistence, source adapters, staged atomic
   imports, cross-authority deduplication and data lifecycle handling.
4. Add evidence-led candidate matching, wider basemap coverage and indexed
   viewport tiles. The bounded pilot uses GeoJSON, not a national serving strategy.
5. Validate a real authority pilot, backup/restore, licence revocation and hardware
   performance before national rollout. No national matching coverage is promised.

Automated private-individual ownership lookup, paid title-link integration, public
hosting and remote team access remain outside scope. Corporate-data ingestion and GeoPackage controls are
not shown as working features in this preview.