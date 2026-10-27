# RES-101 · Customer ticket history

| Field        | Value                                         |
|--------------|-----------------------------------------------|
| Ticket       | RES-101                                       |
| Epic         | Customer portal                               |
| Owner        | Customer Experience                           |
| Requested by | Support lead, Customer Experience team        |
| Branch       | `portal`                                      |
| Status       | Draft — blocked on open questions OQ-1…OQ-16 (critical and high)  |
| Last updated | 2026-10-27                                    |

## Background

**User story:** As a customer, I want to see the history of my support tickets in the portal, so that I can follow up without emailing support.

**Why now:** About a third of inbound support volume is "any update on my ticket?". A self-serve history removes that load.

**What exists today:**
- The **portal gateway** (owned by another team) handles login. For a logged-in customer it calls Resolve and passes the verified email in the `X-Customer-Email` header. The task states that customers never call Resolve directly.
- `tickets.customerEmail` holds the email **as typed** when the ticket was created. Creation checks it against a basic email regex but does not trim or lowercase it ([tickets.service.ts](../src/tickets/tickets.service.ts)).
- A ticket has `id`, `subject`, `description`, `customerEmail`, `priority`, `status`, `createdAt`, `updatedAt` and `resolvedAt`. Dates are stored as ISO-8601 strings.
- Comments have `author` (free text), `body`, `internal` and `at`, ordered by `seq`. Agents write two kinds: replies to the customer, and internal notes (`internal: true`).
- `TicketsRepository.save` updates `updatedAt` on **every** save, including when an internal note is added.
- The existing `GET /tickets` and `GET /tickets/:id` return every field and every comment, internal notes included. They have no auth.
- Ticket statuses are `new`, `open`, `in_progress`, `waiting_customer`, `resolved` and `closed`. Transitions are `new → open → in_progress ⇄ waiting_customer`, then `in_progress → resolved → closed`.

## Acceptance Criteria

Tests are named `RES-101 AC-<n> — <title>`. Where an AC depends on an open question, it holds only once that question is decided.

- **AC-1 — Only my tickets**
  Given I am logged in, when I open my ticket history, then I see all of my tickets and none belonging to any other customer. *(Depends on OQ-3.)*
- **AC-2 — No internal notes**
  Given a ticket of mine has replies and internal notes, when I view it, then I see the replies and none of the internal notes.
- **AC-3 — Newest first**
  Given I have several tickets, when I open my history, then they are ordered by `createdAt`, newest first. *(Tie-break: OQ-20.)*
- **AC-4 — Filter by status**
  Given I have open and closed tickets, when I filter by a status, then I see only tickets in that status. *(What "open" means and how invalid values behave: OQ-11.)*
- **AC-5 — Empty history is not an error**
  Given I have never contacted support, when I open my history, then I get a success response with an empty list.
- **AC-6 — No identity, no tickets**
  Given a request arrives without a customer identity, when Resolve receives it, then it is rejected and no tickets are returned. *(What counts as "no identity", and which status code: OQ-17.)*

Each ticket in the response contains subject, status, priority (OQ-5), created time, last-updated time (OQ-10) and the conversation. Each conversation message shows who wrote it (OQ-6), what they wrote, and when.

## Invariants

- **INV-1 — Customer isolation:** a response only ever contains tickets whose owner matches the identity the gateway sent. Enforced by: an AC-1 test that uses two or more customers, including emails that differ only by letter case.
- **INV-2 — Internal notes never leave:** no comment with `internal = true`, and nothing derived from one, reaches a customer response. Enforced by: the AC-2 test and a test that checks the exact response keys.
- **INV-3 — Allowlisted output:** the customer response is built from an explicit list of fields, never by serialising the `Ticket` or `TicketComment` entity. Adding a field to an entity must not change the customer response. Enforced by: a test on the exact keys, plus review.
- **INV-4 — Read-only:** the endpoint changes no ticket, comment, `updatedAt` or audit entry, unless OQ-19 decides that reads are audited. Enforced by: a test that compares state before and after the call.
- **INV-5 — Existing behaviour unchanged:** existing endpoints and the existing 14 tests keep working without edits. Enforced by: `npm test`.
- **INV-6 — Dialect-neutral:** any query or schema change works the same on Postgres and SQLite (no Postgres-only functions). Enforced by: tests running on SQLite.

## Non-goals

- Login and sessions: the gateway handles these.
- Creating, editing, replying to or closing tickets from the portal.
- Email notifications.
- AI triage: owned by RES-102.
- Fixing the existing `/tickets` endpoints' exposure of internal notes, unless OQ-2 says otherwise.

## Open questions

Ranked by **blast radius**, worst first:

- **Critical:** a wrong answer leaks another customer's data or an internal note. Legal treats this as a data breach.
- **High:** a wrong answer gives customers misleading or sensitive information, or quietly hides their tickets.
- **Medium:** the API contract is unclear, so the gateway team and tests can't rely on it.
- **Low:** cosmetic or process issues.

Each row says which kind of gap it is: **A** = ambiguity, **E** = missing edge case, **T** = undefined state transition, **U** = unstated assumption.

### Critical — data breach

| #    | Kind | Question | Why it matters | Proposed default | Owner | Decision |
|------|------|----------|----------------|------------------|-------|----------|
| OQ-1 | U | **How is "only reachable through the gateway" enforced?** Terraform opens the app port to `0.0.0.0/0`, and nothing in Resolve proves a request came from the gateway. | Anyone who reaches the port can set `X-Customer-Email: victim@x.com` and read that customer's tickets and history. | Restrict the security group to the gateway, **and** require a shared secret or mTLS between gateway and Resolve. Reject requests without it. | Platform + gateway team | open |
| OQ-2 | U | **Can the gateway or the internet reach the existing `GET /tickets` and `GET /tickets/:id`?** They return every customer's tickets and internal notes. | A new endpoint that filters correctly is useless if the old ones are reachable on the same port. | Treat them as agent-only. Either put them behind the same network restriction, or block them at the gateway. Record which. | Platform | open |
| OQ-3 | A | **How is email matched?** The stored email keeps the case it was typed with; the gateway email is "verified". Is `John@X.com` the same customer as `john@x.com`? Are `+tags` or Gmail dots the same? | An exact match that is too strict hides real tickets (fails AC-1). A match that is too loose (aliases, dots) shows one person's tickets to another person. That is a breach. | Trim, then compare case-insensitively on the whole address. **Never** strip `+tags` or dots. Do not rewrite stored data. | Product + Legal | open |
| OQ-4 | U | **Is the `internal` flag reliable?** `addComment` stores `internal = (input.internal === true)`. A client that sends `"true"` (a string) or `1` creates a **public** comment. Existing rows may already contain notes flagged this way by mistake. | The privacy requirement depends entirely on that flag. If it fails, it fails open: the note is shown. | Before launch, audit existing comments for likely mis-flagged notes. Reject non-boolean `internal` values. That second fix is outside RES-101; it needs its own ticket. | Support lead + Eng | open |
| OQ-5 | A | **Should customers see priority at all?** This is the support lead's open question ("a customer who sees `low` will be upset"). | It is an internal judgement. Showing it can cause complaints, and "low" can read as "we don't care". | Leave priority out of the customer response. That contradicts requirement 2, so the product owner must sign off. | Support lead + Product owner | open — **must be decided before building** |
| OQ-6 | A | **What does "who wrote each message" show?** `author` is free text: agent names, internal emails, or team names such as "fraud-team". | Showing the raw author can reveal staff identities, internal email addresses or internal team names. That is "something internal reaching a customer". | Show `"Support"` for agent messages, and `"You"` for messages written by the customer. That needs a rule for spotting the customer's messages (see OQ-18). | Support lead | open |
| OQ-7 | U | **Can a shared cache store the response?** The URL is the same for every customer; only the header differs. | If the gateway, CDN or proxy caches by URL, customer B can get customer A's history. | Send `Cache-Control: no-store` and `Vary: X-Customer-Email`, and confirm the gateway does no caching. | Gateway team | open |
| OQ-8 | U | **Does the gateway strip any `X-Customer-Email` the browser sends** before setting its own? | If not, a logged-in customer can impersonate anyone even through the gateway. | Required gateway guarantee. Get it in writing in the gateway contract. | Gateway team | open |
| OQ-9 | E | **What if a ticket's email was typed wrong** (by an agent, or by the customer) and the typo is someone else's real address? | That stranger sees the ticket and all public replies. This risk comes from matching on "email as typed". | Accept it and document it, or limit the history to tickets the customer created. Legal decides. | Legal | open |

### High — wrong or sensitive information, or hidden tickets

| #     | Kind | Question | Why it matters | Proposed default | Owner | Decision |
|-------|------|----------|----------------|------------------|-------|----------|
| OQ-10  | A | **What does "last updated" mean for a customer?** `updatedAt` changes on **any** save, including adding an internal note. | The customer sees "updated 5 minutes ago" with no new message, which shows that a hidden note exists. It is a side channel around INV-2. | Customer-facing "last updated" = the latest of `createdAt`, the newest public comment, and the last status change. The last status change isn't stored on the ticket today (it's only in the audit log), so this needs a design decision. | Product + Eng | open |
| OQ-11  | A / T | **Which status vocabulary does the customer see and filter by?** There are six internal statuses. "Only open tickets" might mean status `open`, or everything not yet resolved or closed. | A literal filter on `open` hides `new`, `in_progress` and `waiting_customer` tickets that the customer considers open. | Map to customer labels, for example `new`/`open`/`in_progress` → "In progress", `waiting_customer` → "Waiting for you", `resolved` → "Resolved", `closed` → "Closed". Filter on the customer label. | Product | open |
| OQ-12  | T | **What does `waiting_customer` ask the customer to do?** The portal is read-only, so a customer can't reply from it. | The customer sees "waiting for you" with no way to act, and emails support anyway, which defeats the purpose of the feature. | Show what action is needed (for example "reply to our last email"). Leave in-portal reply out of scope. | Support lead | open |
| OQ-13 | A | **Is the ticket `description` part of the conversation?** The list in requirement 2 doesn't include it, but it is what the customer originally wrote. | Without it, a conversation can begin with an agent replying to nothing. | Show `description` as the first message, authored by the customer, at `createdAt`. | Product | open |
| OQ-14 | E | **What if the customer's login email changes,** or several people share one mailbox (for example `support@company.com`)? | After a change, the history looks empty. With a shared mailbox, every holder sees every ticket. | Accept for v1 and document it. Linking by account ID instead of email is future work. | Product | open |
| OQ-15 | U | **May the customer email appear in logs or error messages?** | Personal data in logs widens the scope of any breach. | Never log the raw email and never echo it in a response. Log a hash if correlation is needed. | Eng + Legal | open |
| OQ-16 | T | **Can comment visibility or ticket ownership change later?** There is no endpoint for either today, but if one is added, a reply could become internal after the customer saw it, or a ticket could move to another customer. | Anything decided at write time would show stale or wrong data. | Always decide visibility and ownership when the ticket is read; never cache them per customer. This is stated in INV-1 and INV-2. | Eng | open |

### Medium — contract and behaviour

| #     | Kind | Question | Proposed default | Owner | Decision |
|-------|------|----------|------------------|-------|----------|
| OQ-17 | E | **What counts as "no customer identity" in AC-6?** Header missing, empty, whitespace only, not an email, or several values (Node joins repeated headers into `"a@x.com, b@y.com"`). Which status code and body? | All of these are rejected with `401` and a generic message that never echoes the header. A list of emails is never split and matched separately. | Eng + Gateway team | open |
| OQ-18 | A | **How do we tell a customer's message from an agent's?** Comments have no author type. | If the author matches the ticket's `customerEmail` (case-insensitive), it is the customer; anything else is "Support". Do not add a schema change in RES-101. | Eng | open |
| OQ-19 | U | **Are portal reads audited?** Today only changes are audited, so if a leak is reported, nobody can see who read what. | Record `portal.history_viewed` with a hashed email. This contradicts INV-4 as written, so decide which one wins. | Legal | open |
| OQ-20 | E | **How are tickets with the same `createdAt` ordered?** Within a ticket, are messages oldest first? | Tickets: `createdAt` newest first, then `id`. Messages: oldest first, by `seq`. | Eng | open |
| OQ-21 | A | **Endpoint path and response shape.** A bare array, or `{ tickets: [] }`? Does each ticket include its `id`, so the customer can quote it when emailing support? | `GET /portal/tickets?status=<label>` returning `{ tickets: [...] }`. Include `id`, since it isn't sensitive and makes follow-up emails easier. | Eng + Gateway team | open |
| OQ-22 | E | **Invalid or repeated `status` values** (`?status=foo`, `?status=open&status=closed`, wrong case)? | Return `400` naming the allowed values. Accept one value only. Match case exactly. | Eng | open |
| OQ-23 | E | **Pagination and size limits** for customers with many tickets or long conversations. Comments load eagerly today. | No pagination in v1. Document the limit and revisit when volume grows. | Eng | open |

### Low — cosmetic and process

| #     | Kind | Question | Proposed default | Owner | Decision |
|-------|------|----------|------------------|-------|----------|
| OQ-24 | A | Timestamp format and timezone in the response. | ISO-8601 in UTC, as stored. The gateway or UI formats them for display. | Eng | open |
| OQ-25 | U | HTTP-level tests are needed for AC-6 and for headers, but no controller or e2e test setup exists, and `supertest` isn't a dependency. | Add an HTTP test setup alongside the existing service spec, without changing the existing spec. | Eng | open |
| OQ-26 | U | Where are decisions and review findings recorded? | In this file's **Decision** column, plus the PR description for review findings. | Eng | open |
| OQ-27 | U | Architecture docs list "internal comments are not filtered" as known gap #1. | Update [architecture-core.md](../docs/architecture/architecture-core.md) when this ships. | Eng | open |
