# Core Architecture

Written for: engineers new to this codebase who need the big picture before changing it.

Resolve v0 ("Core Tickets") is a small REST API for customer support tickets. It is a NestJS 11 application on TypeORM 0.3, backed by PostgreSQL 16 in production and in-memory SQLite in tests. It runs as one Node process in one Docker container, next to a Postgres container, on a single EC2 host.

## 1. System context

```
 client (curl, agent, UI)
        │  HTTP/JSON, :3000
        │  X-Actor header (optional, trusted, not authenticated)
        ▼
 ┌──────────────────────────┐        ┌────────────────────┐
 │ resolve (NestJS app)     │ TCP    │ PostgreSQL 16      │
 │ tickets · audit · stats  │───────▶│ tickets            │
 │ schema via synchronize   │ :5432  │ ticket_comments    │
 └──────────────────────────┘        │ audit_entries      │
                                     └────────────────────┘
```

There is no queue, cache, background worker, or auth layer. Every request is handled synchronously inside the HTTP request.

## 2. Module structure

`AppModule` wires one TypeORM connection and three feature modules.

| Module | Role | Exports |
|---|---|---|
| `AuditModule` (`@Global`) | Records and lists audit entries | `AuditService` |
| `TicketsModule` | Ticket and comment lifecycle, owns the `/tickets` routes | `TicketsService`, `TicketsRepository` |
| `StatsModule` | Read-only aggregates for `/stats` | nothing |

`AuditModule` is global, so any module can inject `AuditService` without importing it. `StatsModule` does not own any data. It depends on `TicketsModule` only to reuse `TicketsRepository`.

The entry point is `src/main.ts`. It boots `AppModule` and listens on `PORT` (default 3000).

## 3. Layering inside a feature

Each feature follows the same three-layer path:

```
Controller ── thin: parses HTTP input, reads X-Actor (default "api")
    │
Service ───── validation, status machine, orchestration, audit calls
    │
Repository ── the only code that touches TypeORM repositories
    │
PostgreSQL
```

Rules that hold across the codebase:

- Services never use the TypeORM `DataSource` directly. They go through a repository.
- Controllers contain no business logic.
- Validation failures throw `BadRequestException` naming the offending field.

`StatsController` is the one exception to the controller rule. It does the aggregation itself, in memory, over `TicketsRepository.findAll()`. That is fine at v0 volume and is the first thing to move into SQL if the dataset grows.

## 4. Data model

Three tables, all created by TypeORM `synchronize: true`.

- **`tickets`**: `id` (`tkt_xxxxxxxx`), subject, description, customer email, priority (`low | normal | high | urgent`), status, `createdAt`, `updatedAt`, `resolvedAt`.
- **`ticket_comments`**: `seq` (auto-increment, used for ordering), `id` (`cmt_xxxxxxxx`), author, body, `internal` flag, `at`, and a foreign key to `tickets` with `ON DELETE CASCADE`.
- **`audit_entries`**: `seq` (auto-increment), actor, `action`, `ticketId`, `details` (JSON), `at`.

Ticket comments are loaded eagerly with their ticket. Saving a ticket cascades to its new comments.

Two conventions shape the schema:

- **Dialect-neutral types.** Dates are ISO-8601 strings in `varchar` columns, and JSON uses `simple-json`. This keeps Postgres at runtime and better-sqlite3 in tests behaving identically. Do not add Postgres-only types or functions.
- **IDs are prefixed random strings.** `newId(prefix)` takes the first 8 characters of a UUID, so `tkt_` and `cmt_` IDs are short and not guaranteed unique at scale.

## 5. Core flows

### Create a ticket

```
POST /tickets  { subject, description, customerEmail, priority }
  → TicketsController.create            (actor from X-Actor, default "api")
    → TicketsService.create
        validate fields (throws 400 on the first failure)
        build Ticket, status = "new", comments = []
        TicketsRepository.save            (sets updatedAt)
        AuditService.record "ticket.created"
  ← 201 Ticket
```

### Change status

```
POST /tickets/:id/status  { to }
  → TicketsService.changeStatus
        findById                          (404 if missing)
        check ALLOWED_TRANSITIONS[current] includes `to`   (else 400, lists allowed)
        set status; set resolvedAt when moving to "resolved"
        save; AuditService.record "ticket.status_changed" { from, to }
```

The state machine is a single table in `tickets.service.ts`:

```
new → open → in_progress → resolved → closed
             in_progress ⇄ waiting_customer
```

`closed` is terminal, and there is no path back from `resolved` to `in_progress`.

### Add a comment

```
POST /tickets/:id/comments  { author, body, internal? }
  → TicketsService.addComment
        findById; validate author and body
        push a TicketComment onto ticket.comments
        save; AuditService.record "ticket.commented" { commentId, internal }
```

### Read paths

- `GET /tickets` and `GET /tickets/:id` read through the repository and return comments in `seq` order.
- `GET /audit` lists all entries, or only one ticket's entries with `?ticketId=`.
- `GET /stats` returns counts by status and priority, and the average minutes from `createdAt` to `resolvedAt`.

## 6. Cross-cutting concerns

**Audit.** Every mutation writes an audit entry through `AuditService.record(actor, "entity.verb", ticketId, details)`. The actor is whatever the client sent in `X-Actor`. The server does not verify it. Adding a new mutation means adding a matching audit call.

**Errors.** Validation and illegal transitions return 400. Unknown IDs return 404. Errors use Nest's standard exception classes, so no custom error layer exists.

**Configuration.** Environment variables only: `PORT`, `DATABASE_URL`, plus compose-level `APP_PORT` and `POSTGRES_*`. Nothing loads a `.env` file at runtime.

**Schema management.** `synchronize: true` in `app.module.ts` rebuilds the schema from entities at boot. This is a v0 shortcut with a TODO to switch to migrations. Any schema change to a deployed database needs that decision first.

## 7. Testing architecture

The only spec is `src/tickets/tickets.service.spec.ts`, with 14 tests. It builds a real Nest testing module with an in-memory better-sqlite3 DataSource, and runs the real `TicketsService`, `TicketsRepository`, and `AuditService` against it. There are no mocks of project code. There are no controller or end-to-end tests yet.

## 8. Build, runtime, and deployment

- **Local development:** `docker compose up -d db` starts Postgres, then `npm start` runs the app with ts-node.
- **Container image:** a two-stage Dockerfile on `node:22-alpine`. The build stage compiles with `tsc`. The runtime stage installs production dependencies and runs `node dist/main.js`. Native build scripts are skipped, so better-sqlite3 is not built into the image.
- **Compose stack:** `db` (Postgres 16, healthcheck, `pgdata` volume) and `app`, which waits for the database to be healthy.
- **Infrastructure:** `terraform/` provisions one EC2 instance with Docker and compose preinstalled, a security group, and an SSH key pair. State is local. Deploys are wired through GitHub secrets populated from Terraform outputs.

## 9. Known gaps

These are architectural gaps in v0, not bugs in a single function:

1. **Internal comments are not filtered.** `ticket_comments.internal` marks agent-only notes, but both ticket read endpoints return every comment. Any customer-facing route must filter them out before it ships.
2. **No authentication.** `X-Actor` is trusted as sent, so the audit trail records claims, not verified identities.
3. **No migrations.** `synchronize: true` will alter the schema on boot. This is unsafe once the database holds data you care about.
4. **Stats are computed in memory.** Every `/stats` call loads all tickets.
5. **Eager comment loading.** Every ticket read loads all its comments, which grows with ticket history.

## 10. Scope

v0 covers only what the list above describes. The README's roadmap (SLA engine, review gates, triage agent, watchdog, chatbot, and so on) is planned for later classes, and should not be built ahead of time.
