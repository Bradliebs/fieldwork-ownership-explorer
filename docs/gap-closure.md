---
title: Gap closure implementation backlog
description: Delivery sequence, acceptance criteria and external dependencies for the expanded fieldwork scope.
---

## Delivery boundary

The expanded scope was authorized on 2026-09-11. It is not all implemented.
The working default is local-first Windows operation, with no paid service
activation, external case-data transfer or shared-server deployment. Existing
samples, live case storage and running application instances are not test data.

Shared hosting, organizational identity, data-provider licences and outbound
communication require explicit configuration and approval before activation.
Provider adapters or mock responses alone do not close an integration gap.

## Work and acceptance

| Gap | State | Completion evidence |
| --- | --- | --- |
| Recoverable drafts | Implemented with limits | New/existing and incomplete drafts recover after reload or tab closure; failed checkpoints are visible; stale drafts cannot overwrite cases; checkpoints survive server restart and backup restoration. Uncheckpointed changes and pending uploads remain outside recovery. |
| Multi-parcel investigations | Implemented with fixed scope | Up to 50 authoritative parcels per case; preserved legacy cases and source snapshots; explicit title/permission scope; per-parcel gaps; deduplicated sales; scoped reports and requests. Parcel sets cannot be changed after creation. |
| Document preview | Implemented with limits | Hash-checked local text/image/PDF previews, bounded page rendering, zoom/page controls, visible corruption failures and retained downloads. No document scripts, interactive annotations or signature validation. PDF fonts/decoders are bundled. |
| Evidence linking | Implemented | Case-document pickers retain manual references; existing validation rejects cross-case references; content hashes reject duplicate uploads unless deliberately confirmed as a separate audited copy. |
| Historical revisions | Implemented | Read-only saved revisions, full recorded snapshots and field/record comparisons. Historical document membership is preserved and current unsaved edits are untouched. |
| Cross-case oversight | Implemented on demand | Saved-case filters for unresolved requests, 30-day expiry, missing dates and retention review; links open the exact case. Refresh is explicit; no background alerts. |
| Records lifecycle | Non-destructive controls implemented | Audited reviewer/date/reason, archive/reopen and hold/release; archived cases reject ordinary edits/uploads until separately reopened; reports and oversight expose status. Reviewer identity is asserted, not authenticated. Deletion, redaction, audit minimization and backup retention still require policy. |
| Ownership research | Account preflight and private staging implemented; activation pending | Licence profiles, expiry/permission gates, bounded configurable ownership CSV intake and verifiable source/candidate archives. No API adapter or case acceptance yet; actual product mappings, licensed inputs, coverage and commercial-use approval remain required. |
| Planning and constraints | Pending approved datasets | Import versioned planning/constraint layers with coverage and currency warnings; test intersections in the correct coordinate reference system; absence of a record is not absence of a constraint. |
| GIS interoperability | Saved-revision exports implemented | GeoPackage and GeoJSON preserve WGS 84 polygon coordinates/holes and source provenance; GeoPackage includes normalized title/request scope tables. Tests check SQLite integrity, headers and geometry round-trip. ArcGIS/QGIS desktop acceptance, re-import and multipart remain pending. |
| Mobile collection | Pending architecture | Capture GPS accuracy, photos and forms; verify offline storage, device permissions, synchronization conflicts and device-loss controls on representative hardware. |
| Team coordination | Pending deployment decision | Authenticated shared cases, task assignments, concurrent edits, audit actors and per-case authorization; no exposing the current loopback app as a team server. |
| Enterprise access | Pending identity provider | Enforce server-side roles, session lifecycle, SSO, account removal and organizational isolation; test authorization failures. |
| Sending and signatures | Pending service selection | User-approved delivery, recipient checks, idempotent sending, signed callbacks and reconciled status; preserve manual handoff; a signature alone does not establish authority. |
| OCR and document assistance | Local English transcription implemented | Bundled Tesseract worker/model; bounded raster input; 60-second limit and cancellation; image and PDF-page recognition; explicit review before transcript download with document hash/page/raw output. No automatic case mutation. Language/handwriting/layout qualification and hard OS resource isolation remain pending. |
| Release acceptance | Pending | Packaged Windows recovery, power-loss/disk-full, representative devices, maximum loads, soak, independent restore and human pilot; legal/licence/security review. |

## Sequence

1. Complete draft recovery and its failure checks.
2. Deliver multi-parcel case scope and evidence/history inspection in separate,
   backward-compatible changes.
3. Add cross-case oversight; resolve retention policy before destructive actions.
4. Confirm GIS/data-provider contracts and implement approved local imports.
5. Decide team/mobile architecture and identity; activate external communication
   only with approved providers, recipients and credentials configured outside chat.
6. Complete operational and human acceptance before a general release.

Every implementation must retain source snapshots, stale-write protection,
unknown ownership states and the distinction between factual readiness and legal
authority. No new feature substitutes for the outstanding release gates.

The [licensed account setup](licensed-accounts.md) separates usable private intake
tools from future provider-specific API activation. Credential-presence checks do
not establish authentication, licensing entitlement or a functioning connector.

## Verification on 2026-09-11

The expanded local workflows passed 86 unit/API test executions and the complete
56-test Playwright suite at desktop and narrow viewports. Coverage includes
schema upgrades, isolated server crashes, backup restoration, stale drafts,
multi-parcel recovery, report scope, revision inspection, duplicate decisions,
real PDF canvas rendering, image bounds, inert text and hash-mismatch failures.
Browser checks also cover GeoPackage/GeoJSON downloads, archived-case reopening,
hold release, real image/PDF OCR, transcript review reset, model-load failure and
cancellation. External requests are blocked during the image OCR test. Recognition
does not change saved revisions. Geometry tests preserve polygon holes and exclude
private case content. Typecheck and production server/browser builds passed; the
browser build retains the existing large-chunk warning. Dependency installation
audits reported no vulnerabilities. Mobile screenshots were reviewed.

The remaining rows are not closed by these results. Licensed datasets need actual
approved inputs and coverage verification. Team/mobile operation needs an agreed
identity, synchronization and device-loss model. Sending needs an approved
provider and credentials configured outside chat. Retention destruction requires
an agreed policy covering legal holds, historical records and backup copies.
Representative hardware, soak testing and independent human sign-off remain
release gates, not automated-test claims.