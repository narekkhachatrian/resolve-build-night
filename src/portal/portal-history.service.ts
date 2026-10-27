import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Ticket, TicketStatus } from '../tickets/ticket.entity';
import { TicketComment } from '../tickets/ticket-comment.entity';

// OQ-11 (proposed): internal statuses map to customer labels; the filter uses the label.
export const CUSTOMER_STATUS_LABELS: Record<TicketStatus, string> = {
  new: 'In progress',
  open: 'In progress',
  in_progress: 'In progress',
  waiting_customer: 'Waiting for you',
  resolved: 'Resolved',
  closed: 'Closed',
};

export const ALLOWED_STATUS_FILTERS = [
  ...new Set(Object.values(CUSTOMER_STATUS_LABELS)),
];

export interface CustomerTicket {
  id: string;
  subject: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  conversation: { author: string; body: string; at: string }[];
}

// Builds the customer view from an explicit allowlist, never by serialising the entity (INV-3).
@Injectable()
export class PortalHistoryService {
  constructor(
    @InjectRepository(Ticket) private readonly tickets: Repository<Ticket>,
  ) {}

  // Read-only: no save, so no updatedAt or audit change (INV-4).
  // OQ-3 (proposed): trim and compare case-insensitively on the whole address.
  async listFor(customerEmail: string, label?: string): Promise<CustomerTicket[]> {
    const found = await this.tickets
      .createQueryBuilder('ticket')
      .leftJoinAndSelect('ticket.comments', 'comment')
      .where('LOWER(TRIM(ticket.customerEmail)) = LOWER(:email)', {
        email: customerEmail,
      })
      .getMany();
    return found
      .map((t) => this.toCustomerView(t, customerEmail))
      .filter((t) => !label || t.status === label)
      .sort(newestFirst);
  }

  private toCustomerView(ticket: Ticket, customerEmail: string): CustomerTicket {
    const publicComments = [...(ticket.comments ?? [])]
      .sort((a, b) => a.seq - b.seq)
      .filter((c: TicketComment) => !c.internal); // INV-2: internal notes never leave

    const conversation = publicComments.map((c) => ({
      author: sameAddress(c.author, customerEmail) ? 'You' : 'Support', // OQ-6 / OQ-18 (proposed)
      body: c.body,
      at: c.at,
    }));

    // OQ-10 (proposed): latest of creation, last public reply and resolution.
    // Internal notes do not count, so they cannot move this time.
    const updatedAt = [ticket.createdAt, ticket.resolvedAt, ...publicComments.map((c) => c.at)]
      .filter((v): v is string => !!v)
      .reduce((latest, v) => (v > latest ? v : latest));

    return {
      id: ticket.id,
      subject: ticket.subject,
      status: CUSTOMER_STATUS_LABELS[ticket.status],
      createdAt: ticket.createdAt,
      updatedAt,
      conversation,
    };
  }
}

function sameAddress(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

// OQ-20 (proposed): createdAt newest first, then id ascending.
function newestFirst(a: CustomerTicket, b: CustomerTicket): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
