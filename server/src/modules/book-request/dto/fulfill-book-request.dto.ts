import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class FulfillBookRequestDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bookDockFileId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  matchedBookId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
