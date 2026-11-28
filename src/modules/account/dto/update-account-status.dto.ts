import { IsEnum } from 'class-validator';
import { AccountStatus } from '../../../generated/prisma/client.js';

export class UpdateAccountStatusDto {
  @IsEnum(AccountStatus)
  status!: AccountStatus;
}