import { INestApplication } from "@nestjs/common"
import { Test, TestingModule } from "@nestjs/testing"
import { TypeOrmModule } from "@nestjs/typeorm"
import { AuditService } from "../audit/audit.service"
import { AuditEntry } from "../audit/audit-entry.entity"
import { Ticket } from "../tickets/ticket.entity"
import { TicketComment } from "../tickets/ticket-comment.entity"
import { TicketsRepository } from "../tickets/tickets.repository"
import { TicketsService } from "../tickets/tickets.service"
import { PortalModule } from "./portal.module"

// RES-101 · Customer ticket history
// Spec: specs/portal-history.md
// Tests marked it.skip depend on an open question (OQ-n) and hold only once it is decided.
// Remove the skip when the decision is recorded in the spec.

describe("Portal ticket history (RES-101)", () => {
  let moduleRef: TestingModule
  let app: INestApplication
  let baseUrl: string
  let service: TicketsService
  let repo: TicketsRepository
  let audit: AuditService

  beforeEach(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: "better-sqlite3",
          database: ":memory:",
          dropSchema: true,
          synchronize: true,
          entities: [Ticket, TicketComment, AuditEntry],
        }),
        TypeOrmModule.forFeature([Ticket, TicketComment, AuditEntry]),
        PortalModule,
      ],
      providers: [TicketsService, TicketsRepository, AuditService],
    }).compile()

    app = moduleRef.createNestApplication()
    await app.listen(0)
    baseUrl = await app.getUrl()

    service = moduleRef.get(TicketsService)
    repo = moduleRef.get(TicketsRepository)
    audit = moduleRef.get(AuditService)
  })

  afterEach(async () => {
    await app.close()
  })

  const PORTAL_PATH = "/portal/tickets"
  const ani = "ani@example.am"
  const bob = "bob@example.am"

  const valid = {
    subject: "Cannot log in",
    description: "Password reset email never arrives",
    priority: "high",
  }

  // Seeds through the existing service so the data matches what agents create.
  function ticketFor(customerEmail: string, subject = valid.subject) {
    return service.create("test", { ...valid, subject, customerEmail })
  }

  // The gateway sets X-Customer-Email after login. Omit `email` to send no identity.
  async function history(email?: string, query = "") {
    const headers: Record<string, string> = {}
    if (email !== undefined) headers["X-Customer-Email"] = email
    const res = await fetch(`${baseUrl}${PORTAL_PATH}${query}`, { headers })
    const text = await res.text()
    return {
      status: res.status,
      headers: res.headers,
      text,
      body: text ? JSON.parse(text) : null,
    }
  }

  // Moves createdAt so ordering tests do not depend on wall-clock timing.
  async function backdate(id: string, createdAt: string) {
    const ticket = await service.findById(id)
    ticket.createdAt = createdAt
    await repo.save(ticket)
  }

  describe("RES-101 AC-1 — Only my tickets", () => {
    it("returns all of the caller's tickets and none of another customer's", async () => {
      const mine = [
        await ticketFor(ani),
        await ticketFor(ani, "Refund request"),
      ]
      const theirs = await ticketFor(bob, "Bob private issue")

      const res = await history(ani)

      expect(res.status).toBe(200)
      expect(res.body.tickets.map((t: { id: string }) => t.id).sort()).toEqual(
        mine.map((t) => t.id).sort(),
      )
      expect(res.text).not.toContain(theirs.id)
      expect(res.text).not.toContain("Bob private issue")
    })

    it("does not match a longer address that ends with the same text", async () => {
      // A suffix match such as LIKE '%ani@example.am' would leak this ticket.
      await ticketFor("x-ani@example.am")

      const res = await history(ani)

      expect(res.body.tickets).toEqual([])
    })

    it.skip("treats letter case as irrelevant when matching (pending OQ-3)", async () => {
      // Stored as typed; the gateway email is the verified form.
      const stored = await ticketFor("Ani@Example.am")

      const res = await history(ani)

      expect(res.body.tickets.map((t: { id: string }) => t.id)).toContain(
        stored.id,
      )
    })

    it.skip("does not treat +tag or dotted variants as the same customer (pending OQ-3)", async () => {
      await ticketFor("ani+billing@example.am")
      await ticketFor("a.ni@example.am")

      const res = await history(ani)

      expect(res.body.tickets).toEqual([])
    })
  })

  describe("RES-101 INV-1 — Customer isolation", () => {
    it("shows each customer only their own tickets when two customers exist", async () => {
      const aniTicket = await ticketFor(ani)
      const bobTicket = await ticketFor(bob)

      const aniRes = await history(ani)
      const bobRes = await history(bob)

      expect(aniRes.body.tickets.map((t: { id: string }) => t.id)).toEqual([
        aniTicket.id,
      ])
      expect(bobRes.body.tickets.map((t: { id: string }) => t.id)).toEqual([
        bobTicket.id,
      ])
    })

    it.skip("keeps emails that differ only by letter case in the same customer history (pending OQ-3)", async () => {
      // If OQ-3 decides on exact matching, flip these expectations.
      const lower = await ticketFor("ani@example.am")
      const upper = await ticketFor("ANI@example.am")

      const res = await history("ani@example.am")

      expect(res.body.tickets.map((t: { id: string }) => t.id).sort()).toEqual(
        [lower.id, upper.id].sort(),
      )
    })
  })

  describe("RES-101 AC-2 — No internal notes", () => {
    it("shows public replies and hides internal notes", async () => {
      const t = await ticketFor(ani)
      await service.addComment("agent-1", t.id, {
        author: "agent-1",
        body: "We are looking into it",
        internal: false,
      })
      await service.addComment("agent-1", t.id, {
        author: "agent-1",
        body: "Suspect card fraud, check ledger",
        internal: true,
      })

      const res = await history(ani)
      const bodies = res.body.tickets[0].conversation.map(
        (m: { body: string }) => m.body,
      )

      expect(bodies).toContain("We are looking into it")
      expect(bodies).not.toContain("Suspect card fraud, check ledger")
    })

    it("never includes internal note text anywhere in the response", async () => {
      const t = await ticketFor(ani)
      await service.addComment("agent-1", t.id, {
        author: "agent-1",
        body: "Only staff should read this",
        internal: true,
      })

      const res = await history(ani)

      expect(res.text).not.toContain("Only staff should read this")
    })

    it.skip("does not move the customer-visible last-updated time for an internal note (pending OQ-10)", async () => {
      const t = await ticketFor(ani)
      const before = (await history(ani)).body.tickets[0].updatedAt

      await service.addComment("agent-1", t.id, {
        author: "agent-1",
        body: "Internal only",
        internal: true,
      })

      const after = (await history(ani)).body.tickets[0].updatedAt
      expect(after).toBe(before)
    })

    it.skip('labels agent messages "Support" and the customer\'s own messages "You" (pending OQ-6, OQ-18)', async () => {
      const t = await ticketFor(ani)
      await service.addComment("agent-1", t.id, {
        author: "agent-1",
        body: "Hello",
        internal: false,
      })
      await service.addComment(ani, t.id, {
        author: ani,
        body: "Any update?",
        internal: false,
      })

      const res = await history(ani)
      const authors = res.body.tickets[0].conversation.map(
        (m: { author: string }) => m.author,
      )

      expect(authors).toEqual(["Support", "You"])
      expect(res.text).not.toContain("agent-1")
    })

    it.skip("shows the original description as the first message, from the customer (pending OQ-13)", async () => {
      await ticketFor(ani)

      const res = await history(ani)
      const first = res.body.tickets[0].conversation[0]

      expect(first.body).toBe(valid.description)
    })
  })

  describe("RES-101 AC-3 — Newest first", () => {
    it("orders tickets by createdAt, newest first", async () => {
      const jan = await ticketFor(ani, "January")
      const mar = await ticketFor(ani, "March")
      const feb = await ticketFor(ani, "February")
      await backdate(jan.id, "2026-01-10T09:00:00.000Z")
      await backdate(mar.id, "2026-03-10T09:00:00.000Z")
      await backdate(feb.id, "2026-02-10T09:00:00.000Z")

      const res = await history(ani)

      expect(res.body.tickets.map((t: { id: string }) => t.id)).toEqual([
        mar.id,
        feb.id,
        jan.id,
      ])
    })

    it.skip("breaks createdAt ties by id (pending OQ-20)", async () => {
      // The direction of the id tie-break is part of OQ-20; ascending is assumed here.
      const a = await ticketFor(ani, "First")
      const b = await ticketFor(ani, "Second")
      const same = "2026-02-01T12:00:00.000Z"
      await backdate(a.id, same)
      await backdate(b.id, same)

      const res = await history(ani)

      expect(res.body.tickets.map((t: { id: string }) => t.id)).toEqual(
        [a.id, b.id].sort(),
      )
    })

    it.skip("lists messages oldest first, by seq (pending OQ-20)", async () => {
      const t = await ticketFor(ani)
      await service.addComment(ani, t.id, {
        author: ani,
        body: "first",
        internal: false,
      })
      await service.addComment("agent-1", t.id, {
        author: "agent-1",
        body: "second",
        internal: false,
      })

      const res = await history(ani)
      const bodies = res.body.tickets[0].conversation.map(
        (m: { body: string }) => m.body,
      )

      expect(bodies.indexOf("first")).toBeLessThan(bodies.indexOf("second"))
    })
  })

  describe("RES-101 AC-4 — Filter by status", () => {
    // Labels are the proposed customer vocabulary from OQ-11; they are placeholders until it is decided.

    it.skip("returns only tickets in the requested status (pending OQ-11)", async () => {
      const open = await ticketFor(ani, "Still going")
      const closed = await ticketFor(ani, "Done")
      for (const to of ["open", "in_progress", "resolved", "closed"]) {
        await service.changeStatus("test", closed.id, to)
      }

      const res = await history(ani, `?status=${encodeURIComponent("Closed")}`)

      expect(res.status).toBe(200)
      expect(res.body.tickets.map((t: { id: string }) => t.id)).toEqual([
        closed.id,
      ])
      expect(res.body.tickets.map((t: { id: string }) => t.id)).not.toContain(
        open.id,
      )
    })

    it.skip('groups new, open and in-progress tickets under the customer "In progress" label (pending OQ-11)', async () => {
      const fresh = await ticketFor(ani)
      const working = await ticketFor(ani, "Working on it")
      await service.changeStatus("test", working.id, "open")
      await service.changeStatus("test", working.id, "in_progress")

      const res = await history(
        ani,
        `?status=${encodeURIComponent("In progress")}`,
      )

      expect(res.body.tickets.map((t: { id: string }) => t.id).sort()).toEqual(
        [fresh.id, working.id].sort(),
      )
    })

    it.skip.each([
      ["?status=foo"],
      ["?status=closed"],
      ["?status=Closed&status=Resolved"],
    ])(
      "rejects invalid status %s with 400 naming the allowed values (pending OQ-11, OQ-22)",
      async (query) => {
        await ticketFor(ani)

        const res = await history(ani, query)

        expect(res.status).toBe(400)
        expect(res.text).toContain("Closed")
      },
    )
  })

  describe("RES-101 AC-5 — Empty history is not an error", () => {
    it("returns 200 with an empty list for a customer who never contacted support", async () => {
      // Another customer has tickets, so the empty result is not just an empty store.
      await ticketFor(bob)

      const res = await history(ani)

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ tickets: [] })
    })
  })

  describe("RES-101 AC-6 — No identity, no tickets", () => {
    it("rejects a request with no X-Customer-Email header with 401 and returns no tickets", async () => {
      await ticketFor(ani)

      const res = await history()

      expect(res.status).toBe(401)
      expect(res.body?.tickets).toBeUndefined()
      expect(res.text).not.toContain(ani)
    })

    it.skip.each([[""], ["   "], ["not-an-email"], [`${ani}, ${bob}`]])(
      "rejects identity %j with 401 without echoing it (pending OQ-17)",
      async (value) => {
        await ticketFor(ani)
        await ticketFor(bob)

        const res = await history(value)

        expect(res.status).toBe(401)
        expect(res.body?.tickets).toBeUndefined()
        expect(res.text).not.toContain("@")
      },
    )
  })

  describe("RES-101 INV-2 — Internal notes never leave", () => {
    it("keeps internal notes out of the conversation even when they are the only comments", async () => {
      const t = await ticketFor(ani)
      await service.addComment("agent-1", t.id, {
        author: "agent-1",
        body: "staff only",
        internal: true,
      })

      const res = await history(ani)

      expect(res.body.tickets[0].conversation).toEqual([])
    })
  })

  describe("RES-101 INV-3 — Allowlisted output", () => {
    it("returns exactly the allowlisted keys at every level", async () => {
      // If a field is added to Ticket or TicketComment, this must still fail until the allowlist is changed on purpose.
      const t = await ticketFor(ani)
      await service.addComment("agent-1", t.id, {
        author: "agent-1",
        body: "Hi",
        internal: false,
      })

      const res = await history(ani)
      const ticket = res.body.tickets[0]

      expect(Object.keys(res.body).sort()).toEqual(["tickets"])
      expect(Object.keys(ticket).sort()).toEqual(
        [
          "conversation",
          "createdAt",
          "id",
          "status",
          "subject",
          "updatedAt",
        ].sort(),
      )
      for (const message of ticket.conversation) {
        expect(Object.keys(message).sort()).toEqual(
          ["at", "author", "body"].sort(),
        )
      }
    })
  })

  describe("RES-101 INV-4 — Read-only", () => {
    it("does not change tickets or comments, including updatedAt", async () => {
      const t = await ticketFor(ani)
      await service.addComment("agent-1", t.id, {
        author: "agent-1",
        body: "Hi",
        internal: false,
      })
      const before = JSON.parse(JSON.stringify(await service.findById(t.id)))

      await history(ani)

      const after = JSON.parse(JSON.stringify(await service.findById(t.id)))
      expect(after).toEqual(before)
    })

    it.skip("adds no audit entries for a read (pending OQ-19)", async () => {
      const t = await ticketFor(ani)
      const before = (await audit.list(t.id)).length

      await history(ani)

      expect((await audit.list(t.id)).length).toBe(before)
    })
  })

  describe("RES-101 response caching (pending OQ-7)", () => {
    it.skip("marks the response no-store and varies on X-Customer-Email", async () => {
      await ticketFor(ani)

      const res = await history(ani)

      expect(res.headers.get("cache-control")).toContain("no-store")
      expect(res.headers.get("vary")).toContain("X-Customer-Email")
    })
  })
})
