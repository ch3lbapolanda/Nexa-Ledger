import {
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';

import { UserRole } from '../../generated/prisma/client.js';
import { JwtAuthGuard } from '../authentication/guards/jwt-auth.guard.js';

import { AccountService } from './account.service.js';
import { CreateAccountDto } from './dto/create-account.dto.js';
import { FindAccountsDto } from './dto/find-accounts.dto.js';
import { UpdateAccountMetadataDto } from './dto/update-account-metadata.dto.js';
import { UpdateAccountStatusDto } from './dto/update-account-status.dto.js';

interface AuthenticatedRequest {
  user: {
    sub: string;
    email: string;
    role: UserRole;
  };
}

class AdminOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (request.user?.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Admin access required');
    }

    return true;
  }
}

@Controller('accounts')
@UseGuards(JwtAuthGuard, AdminOnlyGuard)
export class AccountController {
  constructor(private readonly accountService: AccountService) {}

  @Post()
  create(@Body() dto: CreateAccountDto) {
    return this.accountService.createSystemAccount(dto);
  }

  @Get()
  findAll(@Query() query: FindAccountsDto) {
    return this.accountService.findAll(query);
  }

  @Get(':id')
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.accountService.findById(id);
  }

  @Patch(':id/metadata')
  updateMetadata(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAccountMetadataDto,
  ) {
    return this.accountService.updateMetadata(id, dto);
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAccountStatusDto,
  ) {
    return this.accountService.updateStatus(id, dto.status);
  }
}