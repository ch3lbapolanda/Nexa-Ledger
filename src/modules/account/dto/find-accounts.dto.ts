import { IsEnum, IsOptional } from 'class-validator';
import {
  AccountStatus,
  AccountType,
} from '../../../generated/prisma/client.js';

export class FindAccountsDto {
  @IsOptional()
  @IsEnum(AccountType)
  type?: AccountType;

  @IsOptional()
  @IsEnum(AccountStatus)
  status?: AccountStatus;
}