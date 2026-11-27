
import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import { UserRole } from '../../generated/prisma/client.js';

import { JwtAuthGuard } from '../authentication/guards/jwt-auth.guard.js';

import { TransactionHistoryQueryDto } from './transaction-history-query.dto.js';
import { TransactionReversalService } from './transaction-reversal.service.js';
import { TransactionService } from './transaction.service.js';

interface AuthenticatedRequest {
  user: {
    sub: string;
    email: string;
    role: UserRole;
  };
}

@Controller('transactions')
@UseGuards(JwtAuthGuard)
export class TransactionController {
  constructor(
    private readonly transactionService: TransactionService,
    private readonly reversalService: TransactionReversalService,
  ) {}

  @Get()
  async findAll(
    @Query() query: TransactionHistoryQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.transactionService.list(
      request.user.sub,
      request.user.role,
      query,
    );
  }

  @Post(':id/reversal')
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

