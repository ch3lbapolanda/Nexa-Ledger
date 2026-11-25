import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';

import { AuthenticationService } from './authentication.service.js';
import { LoginDto } from './dto/login.dto.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { JwtPayload } from './interfaces/jwt-payload.interface.js';
import { Throttle } from '@nestjs/throttler';

type AuthenticatedRequest = Request & {
  user: JwtPayload;
};

@Controller('auth')
export class AuthenticationController {
  constructor(
    private readonly authenticationService: AuthenticationService,
  ) {}

  
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  @Post('login')
  async login(@Body() dto: LoginDto) {
    return {
      message: 'Login successful',
      data: await this.authenticationService.login(dto),
    };
  }
  

  @UseGuards(JwtAuthGuard)
  @Get('me')
  getProfile(@Req() request: AuthenticatedRequest) {
    return {
      message: 'Authenticated user',
      data: request.user,
    };
  }
}