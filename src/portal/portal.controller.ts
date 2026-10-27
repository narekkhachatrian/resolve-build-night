import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Headers,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ALLOWED_STATUS_FILTERS,
  PortalHistoryService,
} from './portal-history.service';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Controller('portal/tickets')
export class PortalController {
  constructor(private readonly history: PortalHistoryService) {}

  // The gateway sets X-Customer-Email after login. Anything that is not one email is rejected (AC-6).
  // OQ-7 (proposed): responses must not be cached across customers.
  @Get()
  @Header('Cache-Control', 'no-store')
  @Header('Vary', 'X-Customer-Email')
  async list(
    @Headers('x-customer-email') email?: string,
    @Query('status') status?: string,
  ) {
    const identity = email?.trim();
    if (!identity || !EMAIL_RE.test(identity)) {
      throw new UnauthorizedException('customer identity required');
    }
    // OQ-22 (proposed): exactly one value, matched exactly, otherwise 400.
    if (status !== undefined && !ALLOWED_STATUS_FILTERS.includes(status)) {
      throw new BadRequestException(
        `status must be one of: ${ALLOWED_STATUS_FILTERS.join(', ')}`,
      );
    }
    return { tickets: await this.history.listFor(identity, status) };
  }
}
