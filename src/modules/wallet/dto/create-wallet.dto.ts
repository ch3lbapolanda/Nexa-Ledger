import { IsIn, IsOptional } from 'class-validator';

export class CreateWalletDto {
  @IsOptional()
  @IsIn(['IDR'])
  currency?: string;
}