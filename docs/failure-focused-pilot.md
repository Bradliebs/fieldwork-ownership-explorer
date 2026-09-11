---
title: Failure-focused field pilot
description: Observe incomplete, assisted and interrupted investigation journeys without collecting sensitive case content.
---

## Status and purpose

Prepared, not executed. Automated navigation tests do not establish field usability.
Test whether people can identify and act on evidence gaps without mistaking record
completeness for ownership certainty or permission to start work.

### Automated departure checks

Five Chromium checks in [draft-departure.spec.ts](../tests/e2e/draft-departure.spec.ts)
passed on 2026-09-10. For new and existing investigations at 1440 px and 390 px,
cancelling the native reload or close warning retains analyst notes and consent
project edits. Saving removes the warning, and saved edits survive reload and
tab closure/reopening. Confirming reload discards unsaved edits without changing
the saved revision.

These departure checks predate durable draft checkpoints. They still establish
that opening a saved case after departure shows its saved revision, not an
automatically applied recovery draft. Browsers may suppress departure warnings;
uncheckpointed changes can still be lost. The checkpoint tests below cover
explicit recovery, not completion of the interrupted-work pilot.

### Automated draft checkpoint checks

Seven Chromium checks in [draft-recovery.spec.ts](../tests/e2e/draft-recovery.spec.ts)
passed on 2026-09-11, including the corrected closed-tab check on rerun. New and
existing drafts recover after reload at 1440 px and 390 px. Reports remain
unavailable until an explicit case save, which clears the editor's recovery copy.
Failed checkpoint writes are visible without claiming a saved case revision.
An empty title and unfinished email survive tab closure; discard requires
confirmation. A stale recovered draft cannot overwrite a newer saved revision.

[Draft storage checks](../tests/draft-recovery.test.ts) verify version-2 migration
with a version-2 safety backup, checkpoint persistence, authenticated writes,
bounded form validation, source snapshots and rejection of stale or closed writes.
[Backup checks](../tests/backup.test.ts) include draft content in restoration.
The HTTP server restart check below now also preserves an acknowledged checkpoint
across forced process termination and later launches.

Only acknowledged checkpoints are recoverable. This does not establish recovery
of keystrokes inside the debounce interval, pending uploads, a checkpoint write
interrupted inside COMMIT, physical power loss or an unavailable local service.
Checkpoint content is private local data and is retained in database backups.

### Automated save recovery checks

Eight checks in [save-recovery.spec.ts](../tests/e2e/save-recovery.spec.ts) passed
on 2026-09-10 at 1440 px and 390 px. They cover rejected creation and update
requests, plus real server commits followed by deliberately dropped responses.
Draft notes and project edits remain in the editor after failure.

Creation retries reuse the original operation ID, including a manual retry after
both automatic attempts lose their responses. The stored result is one case with
one creation event. Updates are not automatically retried. A rejected update can
be manually retried; a committed update with a lost response produces a revision
conflict on retry without adding another revision. The conflict message now
acknowledges either another writer or a prior save with a lost response, rather
than incorrectly asserting that the draft was never saved.

Reopening the saved version still requires confirmation and replaces the current
draft. Preserve any subsequent edits before doing so. These checks do not cover
retrying a changed creation payload after an uncertain result. Process termination
at the store commit boundary is covered separately below.

### Automated upload recovery checks

Four checks in [upload-recovery.spec.ts](../tests/e2e/upload-recovery.spec.ts)
passed on 2026-09-10 at 1440 px and 390 px. A rejected upload leaves no attachment,
revision or history event. Selecting the file again after the failure stores one
attachment and one additional history event. Saved case notes remain unchanged.

For a committed upload followed by a lost response, the editor reports an error
without falsely announcing success or showing an unconfirmed attachment. Uploads
are not automatically retried. Selecting the same file again with the stale case
revision produces a conflict and adds no duplicate. Reopening the saved version
reveals the committed attachment. Its SHA-256 and downloaded bytes match the
original, and it remains visible after reload.

This is revision-based retry protection, not duplicate-file detection. After
reopening, inspect existing attachments before selecting a file again: a new
upload using the latest revision can add another copy. These tests use a small
fictional text file and do not establish maximum-size performance, disk-full
rollback, mid-transaction crash recovery, or interrupted PDF/image uploads.

### Automated process termination checks

Six checks in [investigation-crash.test.ts](../tests/investigation-crash.test.ts)
passed on 2026-09-10 on Windows. Each uses disposable storage and the production
investigation store in a child process. A test-only barrier pauses immediately
before or after SQLite COMMIT, and the parent forcibly terminates that child
without graceful database closure. Creation, update and document attachment are
each checked at both boundaries.

Reopening through the store discards uncommitted changes and preserves committed
revisions. Existing evidence remains intact. The maximum permitted 3,000,000-byte
text attachment survives a committed write with matching bytes and SHA-256; an
uncommitted attachment leaves no document row. Audit snapshots match the recovered
records, SQLite integrity and foreign-key checks pass, and a subsequent save
survives another reopen. The six checks and eight neighboring persistence checks
pass together.

These checks exercise store recovery, not full HTTP server or Windows launcher
restart. They do not interrupt SQLite inside COMMIT or establish power-loss,
disk-full, filesystem corruption, browser-draft recovery or representative hardware
performance. Those remain separate acceptance checks. No live data or running
application instance is used.

### Automated HTTP server restart check

One integration check in [server-restart.test.ts](../tests/server-restart.test.ts)
passed on 2026-09-11 on Windows. It launches the source server entry point with
disposable storage and an available loopback port, saves a case and text evidence
through HTTP, and forcibly terminates only that test-owned process. The stale
instance lock remains until the replacement server reclaims it automatically.

After restart, the saved case, audit history, source release and attachment bytes
are unchanged, the attachment SHA-256 matches, and the saved report loads. The old
write token is rejected; a fresh session token permits the next revision. An
instance-specific shutdown request then stops the server cleanly and removes its
lock. A further launch retains that new revision.

This complements the store commit-boundary tests: termination here occurs after
the HTTP upload succeeds, not during a write. It does not test the packaged Windows
launcher, browser reconnection, power loss or disk-full behavior. Static assets
come from the public fixture directory; built frontend rendering is not exercised.
Existing application instances and live storage are not used.

The existing three-case pilot must include incomplete and adverse outcomes, not
three successful grants. A refusal accurately recorded is a successful task;
obtaining a grant is not the usability success criterion.

## Participants and safeguards

Include a fieldworker, compliance reviewer and operational owner. Include a novice
or infrequent user, keyboard-only operation, 200 percent browser zoom, a narrow
390 px viewport and representative lower-spec Windows hardware. Record uncovered
participant or hardware needs as untested, rather than generalising from experts.

Obtain consent before observation. Use fictional contacts and evidence in an
isolated disposable data directory. Never inject failures into live case storage.
Keep observation notes local, access-controlled and outside the repository. Agree
a deletion/review date before starting. Do not record names, addresses, evidence
bodies, tokens or screenshots containing real case data. No telemetry is required.

## Cases and tasks

| Case | Task and deliberate difficulty | Observe |
| --- | --- | --- |
| Incomplete evidence | Start on a parcel with no linked sale. Add two titles and two similarly named parties; leave evidence missing. Use gap details to correct only the second record. | Correct field receives focus; original record stays unchanged; user can explain why no sale match means unknown. |
| Unresolved consent | Record a request awaiting response and another refused or revoked, using fixture evidence. Save, reopen and inspect the report. | User preserves adverse outcomes, distinguishes recorded decision from evidential support, and does not interpret readiness as works clearance. |
| Interrupted investigation | Edit a saved fixture case, interrupt a save or upload using a test operator, retry, then reload and reopen. Separately close a browser with unsaved work. | User can tell what persisted, find recovery options, and detect missing drafts or files; record actual loss rather than assuming recovery exists. |

For the interruption case, identify a saved baseline and the exact unsaved change
before each experiment. Simulate a rejected request and a response lost after a
save separately: they have different persistence outcomes. Check for duplicate
records after retry. Restart only the disposable application instance.

Before correction tasks, include a missing project field and a request section
with no parties. Observe whether the person understands why adding a request is
unavailable. Do not coach unless they ask or cannot proceed; log every assist.

Ask after each case: What remains unknown? Who else might have an interest?
Does this record authorise work? Ask neutrally before explaining the caveats.

## Observation record

Create one row per attempted task, starting before installation or launch where
applicable. Include failed starts and participants who stop. Link retries to the
original attempt rather than replacing it with a later success.

| Field | Record |
| --- | --- |
| Attempt | Anonymous participant code, case and task, parent attempt for retries |
| Environment | App build, source release, Windows/browser, viewport, zoom, input method |
| Outcome | Unassisted completion, assisted completion, abandoned, blocked, or not attempted |
| Timing | Start, end, time to first meaningful action, recovery time if applicable |
| Friction | Last completed step, hesitation/backtracking, assistance and stated reason for stopping |
| Integrity | Saved baseline, intended change, actual persisted result, lost work and duplicates |
| Interpretation | Correct/incorrect/uncertain answer about missing evidence and authority to proceed |

Report completion and assistance as counts over all attempted tasks, including
blocked and abandoned attempts. Report not-attempted tasks separately. Keep
successful-task times separate from time spent before abandonment. A three-case
pilot yields qualitative findings, not a population-wide success rate.

## Acceptance and follow-up

* Each gap action reaches the intended field or clearly unavailable section without changing a decision or creating a record.
* Keyboard focus stays visible and labels remain readable at both widths and 200 percent zoom.
* Participants distinguish recorded information from complete identification of rights-holders.
* No saved evidence or drafts are silently lost during the observed journeys. Any loss blocks acceptance and needs a reproducible defect.
* The operational owner completes an independent restore using the [operator runbook](../README.md), outside live storage.

Record owner, severity, reproduction steps and retest result for each defect.
Prioritise data loss, misleading evidence conclusions and blocked core tasks.
Retain failed attempts when retesting. Do not mark the pilot passed until all
required scenarios have observations and unresolved release-blocking defects
are fixed. Hardware soak and legal/security review remain separate release gates.