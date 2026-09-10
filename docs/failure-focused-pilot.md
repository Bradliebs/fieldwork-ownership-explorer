---
title: Failure-focused field pilot
description: Observe incomplete, assisted and interrupted investigation journeys without collecting sensitive case content.
---

## Status and purpose

Prepared, not executed. Automated navigation tests do not establish field usability.
Test whether people can identify and act on evidence gaps without mistaking record
completeness for ownership certainty or permission to start work.

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