import { Type } from 'class-transformer';
import { IsInt, IsString, MaxLength, Min } from 'class-validator';

export class InspectBookRequestReleaseDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  indexerId!: number;

  @IsString()
  @MaxLength(500)
  releaseGuid!: string;
}
