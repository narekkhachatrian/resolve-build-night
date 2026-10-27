import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Ticket } from '../tickets/ticket.entity';
import { TicketComment } from '../tickets/ticket-comment.entity';
import { PortalController } from './portal.controller';
import { PortalHistoryService } from './portal-history.service';

@Module({
  imports: [TypeOrmModule.forFeature([Ticket, TicketComment])],
  controllers: [PortalController],
  providers: [PortalHistoryService],
})
export class PortalModule {}
