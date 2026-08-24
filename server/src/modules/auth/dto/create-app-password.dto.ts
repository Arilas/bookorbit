import { Transform } from 'class-transformer';
import { IsDateString, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateAppPasswordDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  label: string;

  @IsDateString()
  expiresAt: string;
}
