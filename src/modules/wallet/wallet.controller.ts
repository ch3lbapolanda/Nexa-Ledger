import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';

import { JwtPayload } from '../authentication/interfaces/jwt-payload.interface.js';
import { JwtAuthGuard } from '../authentication/guards/jwt-auth.guard.js';

import { CreateWalletDto } from './dto/create-wallet.dto.js';
import { WalletService } from './wallet.service.js';

type AuthenticatedRequest = Request & {
  user: JwtPayload;
};

@Controller('wallet')
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(
    private readonly walletService: WalletService,
  ) {}

  @Post()
  async create(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateWalletDto,
  ) {
    return {
      message: 'Wallet created successfully',
      data: await this.walletService.create(
        request.user.sub,
        dto,
      ),
    };
  }

  @Get('me')
  async findMyWallet(
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      message: 'Wallet retrieved successfully',
      data: await this.walletService.findMyWallet(
        request.user.sub,
      ),
    };
  }

  @Get('me/balance')
  async getMyBalance(
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      message: 'Wallet balance retrieved successfully',
      data: await this.walletService.getMyBalance(
        request.user.sub,
      ),
    };
  }
}