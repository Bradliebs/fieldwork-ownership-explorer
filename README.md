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

Evidence readiness includes expandable record-specific gaps with keyboard focus
on the relevant field. Checks cover recorded information only, not every possible
title or rights-holder. Use the [failure-focused pilot](docs/failure-focused-pilot.md)
to evaluate incomplete, assisted and interrupted journeys; the human pilot has
not yet been completed.

Local case tools now include recoverable drafts, multi-parcel investigations,
evidence previews and document pickers, historical revision comparisons, and
cross-case oversight. Saved-revision GIS downloads, reviewed local OCR and audited
archive/legal-hold decisions are also available. The [gap closure backlog](docs/gap-closure.md) distinguishes
these implemented workflows from licensed-data, team, mobile, service and release
work that remains pending.

### Licensed account preparation

Licence profiles, secret-safe account preflight, configurable ownership CSV
staging and archive verification are available before accounts are activated.
Staging retains original inputs and provenance privately, requires recorded
storage/backup/research permissions, and never promotes imported assertions into
verified ownership or approved contacts. API connections remain disabled until
provider-specific adapters are implemented and tested. See
[licensed account setup](docs/licensed-accounts.md) for templates, commands,
storage limits and the activation checklist.

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

Sales imports use two previously downloaded local CSV files and an explicit JSON
descriptor. The descriptor records the publication period, canonical source URLs,
licence, attribution and import tool version. It does not permit rolling downloads:

```powershell
npx tsx import-sales.ts C:\Imports\sales-import.json C:\Imports\candidate .local\source-cache
```

Paths inside `sales-import.json` are resolved relative to that file. Its required
shape is:

```json
{
   "releaseId": "bristol-harbourside-2026-09-06",
   "period": "2026-07",
   "lookup": { "path": "lookup.csv", "url": "https://example.invalid/official-lookup.csv" },
   "pricePaid": { "path": "price-paid.csv", "url": "https://example.invalid/official-price-paid.csv" },
   "licence": "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/",
   "attribution": "Required source attribution",
   "addressConditions": "https://www.gov.uk/government/statistical-data-sets/price-paid-data-downloads#using-or-publishing-our-price-paid-data",
   "importToolVersion": "0.1.0"
}
```

Replace the example source URLs with the exact official URLs used to obtain the
local inputs. The importer validates identifiers, preserves multi-polygon
transactions, uses changed records and excludes deletions. Missing linked
transactions or conflicting rows stop the import. Input bytes are retained under
their SHA-256 names in the selected source cache. Changing the parcel file changes
its hash and requires a matching sales import. There are no runtime external
requests, paid calls, UPRN imports or corporate ownership matching in this
milestone.

## Saved investigations

1. Select a real Bristol parcel in Explore and choose Start investigation.
2. Enter an investigation name, question and analyst notes, then Save investigation.
3. Reopen saved work from Investigations, including after restarting the server.
4. Choose Report after saving, then Print / Save as PDF in the report window.

An investigation can hold up to 50 real parcels from the same source release.
Use the inclusion checkbox in parcel details to collect site parcels, then start
the investigation from its primary parcel. That primary parcel is always included.
Creation captures authoritative server parcels, the source manifest and release
checksum. Later edits preserve that
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
lookup or automatic title linking. Existing single-parcel cases remain compatible.
The parcel set is fixed at creation; create a separate case for a changed site.
In multi-parcel cases, checked titles and sent or decided requests require explicit
parcel scope. A granted permission cannot exceed its associated title's parcel
scope. Readiness flags parcels without a checked title or scoped request; this
does not establish complete legal coverage. Sales linked to several site parcels
are captured once per transaction, without allocating their price to each parcel.

### History and oversight

Expand Compare saved revisions to inspect before/after values or the full recorded
revision. Comparisons match workflow records and documents by identifier and do
not replace unsaved editor values. Historical document lists reflect the selected
revision. Source snapshots stay immutable. Historical views show recorded facts,
not newly verified evidence or a mechanism for erasing history.

Case oversight lists saved cases with factual gaps, unanswered requests, expired
grants, grants expiring within 30 days, missing dates, and retention reviews due.
Search by case name or parcel identifier and open the exact case for review.
The evaluation date is shown; refresh to obtain current saved records. No email,
background alert, automated permission decision or deletion is triggered.

### GIS exchange

Save the case, choose GeoPackage or GeoJSON, and use Download saved case GIS.
Downloads bind to the saved revision and preserve WGS 84 longitude/latitude
coordinates, polygon holes, INSPIRE identifiers, source date, URL, licence,
attribution, transform and checksum. Ownership remains unknown.

GeoPackage contains `parcels`, `case_source`, `title_scope` and `request_scope`
tables. Scope tables contain recorded identifiers and statuses, not evaluated
permission or ownership conclusions. Legacy single-parcel scope is preserved;
unscoped multi-parcel records are not assigned invented geometry. GeoJSON contains
the parcel features and provenance. Neither format includes contact routes, case
notes, evidence bytes or sale addresses. Share exports only within permitted terms.

Automated checks cover SQLite integrity, GeoPackage headers, coordinate and hole
round-trips, revision binding and browser downloads. ArcGIS Pro/QGIS desktop
acceptance, GIS re-import and multipart support remain pending; current source
parcels are polygons, not multipart features.

### Records lifecycle

Use the Records tab to record a reviewer, review date and decision reason, archive
or reopen a case, place a legal hold or record its release, and set the next review
date. Hold placement requires a reason; release requires an explicit release
reason. An active hold cannot retain a release reason from an earlier decision.
Review dates cannot move backwards relative to the preceding lifecycle decision.

An archived case permits lifecycle/review-date decisions but rejects ordinary
edits and new attachments. Save reopening as a separate decision before editing.
Reports and oversight show lifecycle status; previous decisions remain in revision
history. Reviewer names are assertions entered by the local operator, not
authenticated identities. A hold does not freeze all case editing or prevent
someone with filesystem access from changing data. There is no destructive
deletion, redaction or physical-erasure guarantee. Those require an approved policy
covering history, recovery drafts, exports and backups.

### Unsaved work and recovery

The editor checkpoints incomplete form values in the local SQLite database after
400 ms without another edit. A checkpoint is separate from a saved case revision
and is never used for a report or request draft. Wait for `Draft checkpoint saved
locally` before leaving; changes made since the last successful checkpoint can
still be lost. Failed checkpoints remain visible and leave the editor intact.

After reload or tab closure, open Investigations and choose a recovery draft.
Recovery requires an explicit action and preserves the original base revision and
creation operation ID. A recovered stale draft cannot overwrite a newer saved
case. Successful case saves and explicit reopening clear that editor's checkpoint;
other editor drafts remain separate. Discard controls remove a recovery draft
without changing saved case revisions. Up to 100 active drafts are retained.

Checkpoint content is confidential, unencrypted local data included in backups.
Discarding a draft does not erase backup copies or guarantee physical erasure of
SQLite pages. Drafts do not include pending file uploads. The local service must be
running for checkpointing and recovery; browser warnings are still best-effort.

A failed save leaves the current draft in the editor. A lost response does not
prove that the write failed: the server may already have committed it. Identical
creation retries reuse the operation ID; updates and uploads are not automatically
retried. A stale revision prevents a retry from adding another update or attachment.
Preserve any unsaved edits before choosing Reopen saved version, which replaces
the editor contents. Inspect saved attachments before uploading again: a new upload
after reopening is checked against existing file hashes. Retaining identical
bytes requires explicit confirmation and creates a separate document audit entry.

Automated checks cover rejected saves/uploads, committed writes with lost
responses, and forced process termination immediately before and after SQLite
commit. They verify complete revisions, matching audit history and attachment
bytes. A real HTTP server restart also preserves saved records and evidence,
reclaims its stale instance lock and requires a fresh write token.
See the [failure-focused pilot results](docs/failure-focused-pilot.md) for the
tested scenarios and limits. These checks do not establish packaged Windows
launcher recovery, power-loss or disk-full safety, or completion of the human pilot.

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
   case. Select the attached document in the relevant evidence picker, use its
   displayed `doc:<id>` reference in the evidence field,
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
approved security process. There is no document deletion control.
Removed workflow records remain in the database audit history.

Preview opens text, PNG/JPEG images and PDF pages locally after checking the
recorded size and SHA-256 hash. Text stays inert; PDF.js renders page canvases
without document scripting, interactive forms or annotation actions. Fonts and
decoders are bundled, not downloaded from a third party. PDF previews are limited
to 200 pages, 20 seconds per load/page operation and 8 million rendered pixels per
page. Images are limited to 16 million pixels and 8,192 pixels per dimension.
Unsupported, encrypted, oversized or damaged files produce a visible failure;
the original remains available for download. Previews are not signature validation,
malware scanning, or a guarantee that every original annotation is displayed.

### Reviewed local OCR

In an image or PDF preview, choose Recognize text locally. Tesseract.js 7 and the
English language model are bundled; evidence is not sent to a third party. OCR
processes one image or PDF page at a time, using at most four million input pixels
and 4,096 pixels per dimension. Larger images are downsampled. A 60-second limit,
Cancel OCR and closing the preview stop the worker job. Browser resource controls
are not a hard operating-system memory quota. Handwriting, other languages,
poor scans, rotated text and complex layouts have not been qualified.

Recognized text is unverified. Engine confidence is not an accuracy guarantee.
Compare the transcript with the original, correct errors, and explicitly confirm
the comparison before downloading. Editing again clears that confirmation. The
text download retains document ID/hash, image/page reference, recognition date,
engine details, reviewed text and raw output. The reviewer confirmation is not an
authenticated signature. No case fields, title checks or consent decisions change
automatically. Transcripts are not checkpointed; closing the preview loses them.
Attach a reviewed transcript through Documents when it belongs in case history.

Local investigations are stored in `.local/investigations.sqlite` using Node's
built-in SQLite API. Node 24.13.1 emits an experimental SQLite warning. The database
contains saved geometry, manifests, notes, contact and consent records, uploaded
documents and edit history; it is not encrypted.
Keep this local workspace and any reports within your intended access boundary.

Database upgrades run as ordered, checksum-identified migrations. Before an
upgrade, the app creates and validates a fresh versioned backup beside the
database, such as
`.local/investigations.sqlite.pre-v2-to-v3.<timestamp>-<id>.bak`. Existing notes,
revisions and source snapshots are preserved; version 1 cases receive an empty
consent workflow, and version 3 adds separate recovery drafts. Startup rejects
unknown versions, incomplete or altered
migration history, failed SQLite integrity checks and broken foreign-key
references. Migration rollback, retry and reopening a pre-upgrade backup are
covered by automated tests. Upgrade backups are not ongoing backup protection.

## Backup and restore

Backup archives contain the investigation database, uploaded evidence and the
synthetic review journal when those files exist. Each archive has a versioned
manifest, file SHA-256 checksums and an HMAC-SHA-256 authentication value. The
authentication key is not stored in the archive.

Create a random key file outside `FIELDWORK_DATA_DIR`, retain it in your approved
secret storage and grant access only to the intended Windows account. The same
key is required to verify and restore every archive created with it. This example
creates a new key and selects it for the current PowerShell session:

```powershell
$keyDirectory = Join-Path $env:USERPROFILE '.fieldwork'
$keyPath = Join-Path $keyDirectory 'backup.key'
New-Item -ItemType Directory -Path $keyDirectory -Force | Out-Null
$keyBytes = [byte[]]::new(32)
[Security.Cryptography.RandomNumberGenerator]::Fill($keyBytes)
[IO.File]::WriteAllText($keyPath, [Convert]::ToBase64String($keyBytes))
$env:FIELDWORK_BACKUP_KEY_FILE = $keyPath
```

Stop the server before each operation. The shared data-directory lock rejects a
backup, restore or recovery while the server is running. Create an archive at an
explicit protected location, then verify it independently:

```powershell
npm run data:backup -- C:\FieldworkBackups\fieldwork-2026-09-09.zip
npm run data:verify -- C:\FieldworkBackups\fieldwork-2026-09-09.zip
```

An unclean process termination can leave `.fieldwork-server.lock` in the data
directory. Server startup automatically reclaims a well-formed server instance
lock whose PID is no longer running; it rejects malformed locks. Backup, restore
and recovery commands do not automatically reclaim existing locks: they fail
closed and report the lock. For manual investigation, select the actual data
directory and inspect the recorded PID:

```powershell
$dataPath = if ($env:FIELDWORK_DATA_DIR) { $env:FIELDWORK_DATA_DIR } else { '.local' }
$lockPath = Join-Path $dataPath '.fieldwork-server.lock'
$lock = Get-Content $lockPath -Raw | ConvertFrom-Json
Get-Process -Id $lock.pid -ErrorAction SilentlyContinue
```

For an installed application, select its configured data directory rather than
the source-checkout default `.local`. Only after independently confirming that no
Fieldwork server or data-management operation is running against that directory
may you remove that specific lock with `Remove-Item -LiteralPath $lockPath`.
Do not remove an active lock. If the record cannot be parsed or process inspection
is inconclusive, stop and investigate rather than assuming the lock is stale.

Restore replaces the complete managed data set. It first authenticates and
validates the staged archive, recovers and checkpoints the current SQLite
database, and creates an authenticated safety archive beside the source archive.
It then replaces the database and journal, removes stale SQLite sidecars and
validates the installed data before deleting rollback state:

```powershell
npm run data:restore -- C:\FieldworkBackups\fieldwork-2026-09-09.zip
```

The JSON result prints the exact safety archive path. Keep that archive until the
restored application has passed an operational check. If power loss or a process
termination interrupts replacement, server startup reports an incomplete restore
instead of opening mixed data. Stop the server and recover the durable originals:

```powershell
npm run data:recover
```

Archives are streamed with exact entry names and bounded extraction. The current
limits are 9 GiB compressed, 8 GiB for the expanded SQLite database, 256 MiB for
the expanded journal and a 200:1 compression ratio. HMAC authentication detects
archives created or altered without the key; it is not encryption. Store archives
as confidential case material. Scheduled backup execution, off-device retention,
key rotation, archival and deletion controls remain operational responsibilities.
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
Record their local paths, canonical URLs, licence text, attribution and bounds in
`pilot-import.json`. Paths are resolved relative to the descriptor. Run the
importer into a candidate directory, never the active release directory:

```powershell
npx tsx import-pilot.ts C:\Imports\pilot-import.json C:\Imports\candidate .local\source-cache
```

The importer is specific to the inspected GML schema, not a general national
ingestion pipeline. It rejects unsupported CRS, malformed rings, duplicate IDs
and count mismatches. It validates parcel, basemap and manifest JSON before
publishing candidate files. Exact source bytes are retained under their SHA-256
names. Run the sales importer against the same candidate to add `sales.json` and
the complete `release.json` descriptor.

INSPIRE is used under the OGL and HMLR/OS conditions. OpenStreetMap context is a
separate ODbL database extract; its downloadable GeoJSON is at
`public/pilot/basemap.json`. No public raster tiles were bulk downloaded.
The OS OSTN15 grid is distributed by PROJ under BSD-2-Clause and is not bundled.
The OSM converter's XML dependency is overridden to patched version 0.9.12; this
importer uses its JSON path, which is exercised by the real-data import.

## Source release operations

Each release contains `parcels.json`, `basemap.json`, `manifest.json`, `sales.json`
and `release.json`. The descriptor binds every runtime file by byte size and
SHA-256, records source periods, URLs, licences, attribution, CRS facts, spatial
bounds and counts, and binds sales to the exact parcel hash.

Stop the server before activation or rollback. Staging copies a candidate into a
private directory, validates every JSON contract and cross-file invariant, then
publishes one immutable release directory. Activation atomically replaces only
the small active pointer:

```powershell
npm run release:stage -- C:\Imports\candidate
npm run release:activate -- bristol-harbourside-2026-09-06
npm run release:status
```

The app keeps the active and previous release available. Roll back while the app
is stopped:

```powershell
npm run release:rollback
```

Release directories and `active-release.json` are stored under
`FIELDWORK_DATA_DIR`, or `.local` by default. A stale or live server lock blocks
activation and rollback. An incomplete candidate or abandoned staging directory
cannot change the active pointer. At startup, the server validates and pins one
release directory for its lifetime; parcel, basemap, manifest and sales reads use
local API endpoints backed by that directory. Existing investigations retain their
original parcel, manifest, sales evidence and parcel release hash after activation
or rollback.

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

Development defaults keep immutable assets under `dist` and writable records
under `.local`. Packaged or administrative launches can set
`FIELDWORK_ASSET_DIR` and `FIELDWORK_DATA_DIR` to absolute or working-directory
relative paths. Writable data must remain outside the static asset directory.

The app does not expose itself to the LAN. It uses the Windows account as its
local access boundary, checks Host/Origin, and requires a random per-launch token
for writes. Reviewer names are audit labels, not authenticated team identities.

## Windows internal pilot artifact

Build the offline Windows x64 artifact with the pinned Node.js 24.13.1 runtime:

```powershell
npm ci
npm run build:release
```

The build produces an unpacked directory, a ZIP, and a ZIP-level SHA-256 file
under `artifacts`. It also includes a CycloneDX SBOM, the production dependency
audit result, dependency licence texts, an allowlisted package notice inventory,
per-file checksums and the Node.js runtime licence. The build fails on a high or
critical production dependency vulnerability or a Node.js licence hash mismatch.

> [!WARNING]
> The artifact is an unsigned internal pilot. It is not approved for public or
> broad enterprise distribution. Verify its SHA-256 through an independently
> controlled release channel before installation.

Extract the ZIP and install for the current user from PowerShell 7:

```powershell
./Install.ps1
```

The default application path is
`$env:LOCALAPPDATA\Programs\Fieldwork Ownership Explorer`. Start it with
`Fieldwork Ownership Explorer.cmd`. Writable investigations, logs and source
releases remain separately under
`$env:LOCALAPPDATA\Fieldwork Ownership Explorer`. The packaged uninstaller
removes application files but preserves this operational data unless
`-RemoveData` is explicitly supplied.

The installed directory also contains `Stop.ps1` for graceful shutdown and
`Operations.ps1` for backup, verification, restore, recovery and source-release
operations. These scripts use the bundled Node runtime and do not require npm,
tsx or a source checkout.

Only one server may own a data directory. A second launch detects the live PID,
reports its existing loopback URL and exits without opening SQLite or release
storage. A well-formed lock owned by a dead PID is recovered automatically at
server startup. A malformed lock fails closed. Administrative backup, restore,
activation and rollback commands remain fail-closed for every existing lock;
inspect the recorded PID before removing one manually.

## Operator runbook

Use a standard Windows account with BitLocker or equivalent full-disk
encryption. Restrict the application data, backup key, archives, reports and
diagnostic exports to approved users. The runtime is offline and loopback-only,
but exported material remains confidential.

Set these paths once in each PowerShell 7 operator session:

```powershell
$InstallPath = Join-Path $env:LOCALAPPDATA 'Programs\Fieldwork Ownership Explorer'
$DataPath = Join-Path $env:LOCALAPPDATA 'Fieldwork Ownership Explorer'
$BackupKeyPath = Join-Path $env:USERPROFILE '.fieldwork\backup.key'
```

### Install, start and stop

1. Compare the artifact ZIP with the SHA-256 received through the controlled
    release channel, then scan the extracted files with approved endpoint
    protection.
2. Run `./Install.ps1` from the extracted artifact. Do not install over a
    running instance or grant inbound firewall access.
3. Start the installed application and confirm health:

    ```powershell
    & (Join-Path $InstallPath 'Fieldwork Ownership Explorer.cmd')
    Invoke-RestMethod http://127.0.0.1:4317/api/health
    ```

4. Before backup, restore, source-release maintenance, upgrade or uninstall,
    stop Fastify and SQLite cleanly:

    ```powershell
    & (Join-Path $InstallPath 'Stop.ps1') -DataPath $DataPath
    ```

Closing the browser does not stop the detached local server. `Stop.ps1` verifies
the lock instance, bundled executable and process start time before requesting
graceful shutdown. Do not use Task Manager termination for routine shutdown.

### Backup schedule and restore drill

Create and verify a backup before each application or source-release change and
on the organisation's approved case-data schedule. Keep at least one verified
copy away from the workstation. Store the key separately; HMAC authentication
detects alteration but does not encrypt the archive.

```powershell
$Archive = 'C:\FieldworkBackups\fieldwork-2026-09-10.zip'
& (Join-Path $InstallPath 'Operations.ps1') backup $Archive -DataPath $DataPath -BackupKeyFile $BackupKeyPath
& (Join-Path $InstallPath 'Operations.ps1') verify $Archive -DataPath $DataPath -BackupKeyFile $BackupKeyPath
```

Run a witnessed restore drill before pilot reliance and after a material upgrade.
Stop the application, verify the selected archive, restore it, retain the printed
safety-archive path, restart, then reopen representative cases and download a
known document to compare its SHA-256. Keep the safety archive until the check
passes:

```powershell
& (Join-Path $InstallPath 'Operations.ps1') restore $Archive -DataPath $DataPath -BackupKeyFile $BackupKeyPath
```

If restore is interrupted, keep the server stopped and recover the durable
originals before retrying:

```powershell
& (Join-Path $InstallPath 'Operations.ps1') recover -DataPath $DataPath
```

See [Backup and restore](#backup-and-restore) for archive contents, limits,
authentication and manual stale-lock handling.

### Source and application releases

Stage and validate a complete local source candidate while the application is
stopped. Activation changes only the atomic active pointer; existing
investigations keep their original source snapshots:

```powershell
& (Join-Path $InstallPath 'Operations.ps1') release-stage C:\Imports\candidate -DataPath $DataPath
& (Join-Path $InstallPath 'Operations.ps1') release-activate bristol-harbourside-2026-09-06 -DataPath $DataPath
& (Join-Path $InstallPath 'Operations.ps1') release-status -DataPath $DataPath
```

To restore the previous source release, stop the application and run:

```powershell
& (Join-Path $InstallPath 'Operations.ps1') release-rollback -DataPath $DataPath
```

Confirm source-specific licence, permitted use, attribution and export recipients
before staging restricted data. INSPIRE outlines remain indicative, Price Paid
addresses are not landowner contact data, and no source activation establishes
ownership certainty.

For an application upgrade, stop the current version, create and verify a data
backup, retain the current artifact and run the new `Install.ps1`. Restart and
check health, diagnostics, representative cases, documents and reports. To roll
back only application files, stop the new version and reinstall the retained
artifact. If startup applied a database migration that the earlier application
does not support, restore the pre-upgrade archive before reinstalling. Data
rollback discards changes made after that archive; record this as a separate,
explicit decision from application rollback.

### Failure and incident response

Use the reported stable error and these fail-closed actions:

* For a live runtime lock, use the existing loopback URL or `Stop.ps1`. Remove a
   lock manually only after its recorded PID is confirmed stopped.
* For an incomplete restore, keep the server stopped and run `recover`.
* For SQLite integrity, unknown-schema, migration-history or broken-reference
   failures, do not edit the database or repeatedly restart. Preserve the data
   directory, logs and latest verified archive, then escalate for recovery.
* For an invalid or incomplete source release, leave the active pointer alone.
   Inspect `release-status`, correct and restage the candidate, or roll back to
   the retained previous release.
* For low writable space, stop case work and free approved local capacity. Do
   not delete evidence, SQLite sidecars or source directories by hand.

While the app is healthy, export diagnostics without case bodies:

```powershell
Invoke-WebRequest http://127.0.0.1:4317/api/diagnostics/export -OutFile C:\FieldworkSupport\diagnostics.json
```

For suspected disclosure, malware or unauthorised local access, stop the app,
disconnect the workstation according to the organisation's incident process,
preserve the data directory and operational logs without opening evidence, and
restrict reports, backups, keys and diagnostics from further sharing. Record the
artifact hash, app/schema/release versions and incident time. Diagnostics exclude
case content; they are not a substitute for preserving authorised evidence.

### Retention and complete removal

Review the factual readiness panel and report on the recorded retention date.
The application has no background reminder, legal-sufficiency decision or
automatic deletion. An authorised owner must decide retention separately for the
live database, reports, backups, safety archives, source inputs and external
document-management references.

Routine uninstall preserves operational data:

```powershell
& (Join-Path $InstallPath 'Stop.ps1') -DataPath $DataPath
& (Join-Path $InstallPath 'Uninstall.ps1')
```

After an approved retention or disposal decision, complete removal deletes the
managed data directory as well:

```powershell
& (Join-Path $InstallPath 'Stop.ps1') -DataPath $DataPath
& (Join-Path $InstallPath 'Uninstall.ps1') -RemoveData
```

`-RemoveData` does not delete backup keys, archives, reports, diagnostics or
source inputs stored elsewhere. Dispose of those locations through the same
approved process and retain the required destruction record.

## Health, diagnostics and logs

Use these loopback-only endpoints while the application is running:

* `/api/health` returns a minimal `{"status":"ok"}` readiness response
* `/api/diagnostics` reports application, schema and release versions, writable
   storage and free bytes, SQLite integrity, last backup status and log path
* `/api/diagnostics/export` downloads the same facts with the bounded operational
   log records as JSON

The exact `127.0.0.1:<port>` Host policy protects these routes. Treat a diagnostic
export as internal operational material even though its schema excludes case
content.

Operational logs are stored at
`FIELDWORK_DATA_DIR\logs\fieldwork.jsonl`, or under the packaged data directory
when the variable is unset. The current file rotates at 1 MiB and retains one
predecessor named `fieldwork.jsonl.1`. Each strict record contains only timestamp,
event, request ID, route template, status, duration, release ID, application and
schema versions, and a stable error code. Request bodies, headers, query values,
tokens, parcel IDs, names, addresses, notes and document metadata are never
captured.

Successful `data:backup` and `data:verify` commands update
`FIELDWORK_DATA_DIR\backup-status.json`. Diagnostics expose only the operation,
completion time and archive filename. A missing status means no successful
backup or verification has been recorded for that data directory; it does not
prove that no external backup exists.

Client reads retry one transient network or server failure. Writes are not
automatically retried, except investigation creation with its stable operation
ID. Validation, revision conflict, storage, release mismatch, access, not-found,
network and unexpected failures are classified centrally. Editors retain unsaved
drafts and move keyboard focus to the actionable alert.

## Windows deployment checklist

Complete these checks for each pilot release and record the evidence with the
release decision:

* Build from a reviewed commit on the pinned Windows and Node.js versions
* Require typecheck, unit/API tests, browser tests, production audit and artifact
   checksum verification to pass in CI
* Compare the downloaded ZIP against the SHA-256 from an independent channel
* Review the CycloneDX SBOM, npm audit result, notices and bundled licence texts
* Keep the unsigned-build warning visible until Authenticode signing, timestamping
   and certificate custody are operational
* Scan the extracted artifact with the organisation's approved endpoint protection
   and record Windows SmartScreen or application-control exceptions
* Install and run as a standard Windows user; do not grant administrator rights
   or inbound firewall access
* Confirm the process listens only on `127.0.0.1` and completes the offline-request
   browser test on the target machine
* Restrict NTFS access to the operational data, backup key, backups, reports and
   diagnostic exports to approved users
* Create and independently verify a backup, then complete a witnessed restore
   drill before relying on the workstation
* Confirm second-launch detection, stale-lock recovery, free-space diagnostics,
   SQLite integrity and log rotation on target hardware
* Verify uninstall preserves operational data by default and test explicit data
   disposal only under the approved retention process

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
Backup tests cover authenticated round trips, uploaded evidence, journal recovery,
tamper and unexpected-entry rejection, server exclusion and interrupted restore
recovery.
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
5. Validate a real authority pilot, run a witnessed restore drill, confirm licence
   revocation handling and measure target hardware performance before national
   rollout. No national matching coverage is promised.

Automated private-individual ownership lookup, paid title-link integration, public
hosting and remote team access remain outside scope. Corporate-data ingestion and GeoPackage controls are
not shown as working features in this preview.