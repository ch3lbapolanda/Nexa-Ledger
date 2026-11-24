
import { Module } from '@nestjs/common';

import { IdentityController } from './identity.controller.js';
import { IdentityService } from './identity.service.js';
import { PasswordHasherService } from './password-hasher.service.js';

@Module({
  controllers: [IdentityController],
  providers: [
    IdentityService,
    PasswordHasherService,
  ],
  exports: [IdentityService],
})
export class IdentityModule {}
