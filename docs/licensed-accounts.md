---
title: Licensed account preparation
description: Configure licence profiles, check future account prerequisites and stage ownership CSV evidence privately without activating external services.
---

## Available now

Fieldwork supports licence/account preflight and private ownership CSV staging.
No credentials are included in the repository, and none of these commands makes
an external request. Account preparation does not activate a subscription,
authenticate with a provider, purchase a record or establish ownership.

Use one profile per provider product or agreement. The disabled
[provider example](../config/licensed-provider.example.json) defines the required
fields. Keep populated profiles and licence references under `.local/providers/`
or another approved private location, not in `public/`, `dist/` or source control.
The local tools do not encrypt files or configure Windows access permissions.

## Record the agreement

Record the exact provider/product, agreement reference, terms URL, permitted
purpose, geographic coverage and exclusions, validity dates and licence reviewer.
Set permission flags only after reviewing the actual agreement. These are local
assertions, not provider-validated entitlements or authenticated approvals.

Ownership staging requires `localStorage`, `backup` and `ownershipResearch`.
The entire original CSV is retained, including unmapped columns, so these
permissions must cover the complete input. `derivedExport` and
`commercialContact` are separate recorded permissions and do not automatically
authorize exports or contact use in the application. No staged records enter
the existing case or GIS export workflows automatically.

Profiles are disabled by default. Missing review, future review dates, future
licence start dates and expired licences block intake. Validity includes the
recorded end date and uses the local system's UTC calendar date.

```powershell
npm run provider:check -- .local/providers/ownership.json
```

Exit codes are `0` for a locally ready ownership-file profile, `2` for a blocked
or unsupported configuration, and `1` for invalid input or an operational failure.
The check reports blockers without printing input bodies or credential values.
The checked-in example intentionally returns `2` until replaced by an approved
private configuration.

## Stage ownership files

The [column mapping example](../config/ownership-columns.example.json) maps logical
fields to exact CSV header names; it is not a claim about any supplier's format.
Required logical fields are `recordId`, `titleNumber`, `proprietor`, `sourceDate`
and `evidenceReference`. `inspireId` is optional; omit its mapping if unavailable.
Source dates must be real, non-future `YYYY-MM-DD` dates. INSPIRE IDs are numeric
source identifiers, not title numbers or verified geometry relationships.

Input is UTF-8 CSV with a header, at most 10 MB and 10,000 records per batch.
Record IDs must be unique within the batch. Use one row per proprietor assertion;
joint proprietors can share a title number but need distinct provider record IDs.
Do not silently discard additional proprietors when mapping wide supplier files.
Formats with multiple proprietor columns, different date conventions or missing
record keys require a reviewed provider-specific conversion before staging.
Large official datasets need a separate streaming importer; this command is for
bounded, approved extracts, not national bulk releases.

```powershell
npm run provider:stage -- .local/providers/ownership.json .local/providers/columns.json C:\Imports\ownership.csv
```

Successful intake creates a uniquely named ZIP under
`FIELDWORK_DATA_DIR/licensed-staging/` (default `.local/licensed-staging/`).
The command refuses configured web assets, public/build directories and junctions
resolving into those locations. Files are written to a partial name, flushed and
renamed after completion. Interrupted `.partial` files are not published imports.
An independent account with filesystem write access remains outside this guard.

Each package contains:

* `source.csv`: Exact original input bytes
* `candidates.json`: Normalized assertions marked candidate, relationship unconfirmed and contact use unconfirmed
* `manifest.json`: Licence/profile snapshot, column mapping, dates, record count and source/profile/mapping/candidate checksums

The command prints only package location, counts and hashes. Saved cases, source
parcel ownership, title checks and contact approvals are unchanged. Packages are
private intake artifacts, not public downloads or case backups. The existing
`data:backup` command does not include this staging directory or provider profiles;
retain them separately under an approved backup/retention policy. ZIP compression
and SHA-256 do not provide encryption or authenticated provenance.

```powershell
npm run provider:verify -- .local/licensed-staging/<package-id>.zip
```

Verification bounds archive entries, checks recorded hashes and re-derives
candidate records from the source and mapping. It separately checks whether the
embedded licence snapshot is still within its recorded validity period. A valid
archive can therefore return `2` after expiry. Verification does not detect
provider-side revocation or a dishonest replacement of all bytes and checksums.
Recheck the current agreement before any later use. Nothing is activated by
verification, and staged candidates are not yet selectable in the case editor.

## Prepare API accounts

For a future API account, use `service` equal to `ownership`, `planning` or
`signatures`, and replace the profile's `access` object with this shape:

```json
{
  "mode": "api",
  "documentationUrl": "https://example.invalid/provider-api-docs",
  "credentialEnv": ["FIELDWORK_PROVIDER_EXAMPLE_CLIENT_ID", "FIELDWORK_PROVIDER_EXAMPLE_CLIENT_SECRET"]
}
```

Only environment-variable names belong in the profile. Configure actual values
through the approved local secret-management process, outside chat and source
control. Reference URLs must use HTTPS without credentials, query strings or
fragments. Preflight reports whether each referenced variable is populated; it
does not validate that credential or echo its value. Do not put secrets into
free-text licence fields. This tooling does not load `.env` files automatically.

All API profiles currently report `connector: not-implemented`, `ready: false`
and `networkEnabled: false`, even when credentials are present. Planning-file
intake and signing delivery are also not implemented. No generic HTTP adapter
will guess authentication, send a case to an arbitrary URL or equate sandbox
responses with production acceptance.

## Account activation checklist

When the accounts are available, supply non-secret provider/product details,
official API documentation and a permitted sample export or sandbox specification.
Then complete the provider-specific work:

1. Confirm permitted storage, retention, backup, derived export, commercial use,
   geographic coverage and record currency with the licence owner.
2. Implement and test actual authentication, approved endpoint allowlists,
   pagination, rate limits, request budgets, timeouts and retry behavior.
3. Add reviewed mappings and case acceptance that preserve source identifiers,
   provenance and uncertainty, including joint owners and ambiguous matches.
4. For planning, validate geometry/CRS, coverage and constraint interpretation.
   For signatures, add explicit send approval, recipient checks, idempotency,
   verified callbacks and reconciliation before enabling delivery.
5. Verify sandbox behavior and failure cases, then approve production activation.
   Existing records must remain traceable after account expiry or revocation.

The production server build includes `provider-cli.js`. Its commands are the same
as the source CLI: `node build/server/provider-cli.js check|stage|verify ...`.
For a packaged distribution, use its bundled runtime and `app/provider-cli.js`,
with explicit `FIELDWORK_DATA_DIR` and `FIELDWORK_ASSET_DIR` settings matching the
deployment. Full packaged-release acceptance remains a separate gate.