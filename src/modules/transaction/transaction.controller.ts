
import {
  Controller,
  ForbiddenException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';

import { UserRole } from '../../generated/prisma/client.js';
import { JwtAuthGuard } from '../authentication/guards/jwt-auth.guard.js';

import { TransactionReversalService } from './transaction-reversal.service.js';

interface AuthenticatedRequest {
  user: {
    sub: string;
    email: string;
    role: UserRole;
  };
}

@Controller('transactions')
export class TransactionController {
  constructor(
    private readonly reversalService: TransactionReversalService,
  ) {}

  @Post(':id/reversal')
  @UseGuards(JwtAuthGuard)
  async reverse(
    @Param('id', new ParseUUIDPipe()) transactionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    if (request.user.role !== UserRole.ADMIN) {
      throw new ForbiddenException(
        'Only administrators can reverse transactions',
      );
    }

    return this.reversalService.reverse({
      transactionId,
      actorId: request.user.sub,
    });
  }
}
