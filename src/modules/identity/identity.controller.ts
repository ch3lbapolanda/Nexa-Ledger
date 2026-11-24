
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';

import { IdentityService } from './identity.service.js';
import { RegisterDto } from './dto/register.dto.js';

@Controller('identity')
export class IdentityController {
  constructor(
    private readonly identityService: IdentityService,
  ) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() dto: RegisterDto) {
    return {
      message: 'Account registered successfully',
      data: await this.identityService.register(dto),
    };
  }
}
