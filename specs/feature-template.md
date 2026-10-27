# <TICKET-ID> · <Feature name>

<!--
Spec template. Copy this file to specs/<feature-slug>.md and replace every <placeholder>.
Delete these HTML comments when the spec is filled in.
Keep each section to its job: context goes in Background, never in Acceptance Criteria.
-->

| Field        | Value                              |
|--------------|------------------------------------|
| Ticket       | <TICKET-ID>                        |
| Epic         | <epic name>                        |
| Owner        | <product owner / team>             |
| Requested by | <who asked for it>                 |
| Branch       | <branch>                           |
| Status       | Draft · In review · Approved       |
| Last updated | <YYYY-MM-DD>                       |

## Background

<!--
Context only: why we are doing this, who the user is, and what already exists.
Nothing here is checked by a test. If a sentence must be true for the feature to ship,
move it to Acceptance Criteria or Invariants.
-->

**User story:** As a <role>, I want <capability>, so that <outcome>.

**Why now:** <the problem today, with a number if there is one>

**What exists today:**
- <relevant existing behaviour, endpoint, entity or field>
- <external systems involved and what they guarantee>

## Acceptance Criteria

<!--
Numbered, checkable, one behaviour each. Each AC gets one automated test named
"<TICKET-ID> AC-<n> — <short title>". Use Given / When / Then.
Name concrete values (status codes, field names, thresholds), not adjectives.
-->

- **AC-1 — <short title>**
  Given <precondition>, when <action>, then <observable result>.
- **AC-2 — <short title>**
  Given <precondition>, when <action>, then <observable result>.
- **AC-3 — <short title>**
  Given <precondition>, when <action>, then <observable result>.

## Invariants

<!--
Rules that stay true across every change, now and in future PRs, not only this one.
Typical topics: privacy, data isolation, failure behaviour, compatibility, cost.
Each invariant should be testable or reviewable; say how it is enforced.
-->

- **INV-1 — <name>:** <rule that must always hold>. Enforced by: <test / review check / type>.
- **INV-2 — <name>:** <rule that must always hold>. Enforced by: <test / review check / type>.

## Non-goals

<!--
What we are NOT doing in this spec, so reviewers can reject scope creep.
Say where it goes instead, if anywhere.
-->

- <thing not built> — <reason or the ticket that owns it>
- <thing not built> — <reason or the ticket that owns it>

## Open questions

<!--
Decisions still needed. Each one has an owner and, once settled, a recorded decision.
Do not start building anything that depends on an unanswered question.
-->

| #    | Question     | Owner   | Decision         | Decided on   |
|------|--------------|---------|------------------|--------------|
| OQ-1 | <question>   | <who>   | <open / answer>  | <YYYY-MM-DD> |
| OQ-2 | <question>   | <who>   | <open / answer>  | <YYYY-MM-DD> |
