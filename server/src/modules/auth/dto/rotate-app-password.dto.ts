import { IsDateString } from 'class-validator';

export class RotateAppPasswordDto {
  @IsDateString()
  expiresAt: string;
}
