import { IsEnum, IsString, MaxLength } from 'class-validator';
import {
  AccountNormalBalance,
  AccountType,
} from '../../../generated/prisma/client.js';

export class CreateAccountDto {
  @IsString()
  @MaxLength(50)
  code: string;

  @IsString()
  @MaxLength(120)
  name: string;

  @IsEnum(AccountType)
  type: AccountType;

  @IsEnum(AccountNormalBalance)
  normalBalance: AccountNormalBalance;
}