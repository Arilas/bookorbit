import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { BOOK_REQUEST_MEDIA_KINDS } from '@bookorbit/types';
import type { BookRequestMediaKind } from '@bookorbit/types';

export class BookRequestMetadataSourceDto {
  @IsString()
  @MaxLength(50)
  providerKey!: string;

  @IsString()
  @MaxLength(255)
  providerId!: string;

  @IsString()
  @MaxLength(100)
  providerLabel!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  isbn10?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  isbn13?: string;
}

export class CreateBookRequestDto {
  @IsString()
  @MaxLength(500)
  title!: string;

  @IsIn(BOOK_REQUEST_MEDIA_KINDS)
  mediaKind!: BookRequestMediaKind;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  subtitle?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(255, { each: true })
  authors?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  seriesName?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  seriesIndex?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  isbn10?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  isbn13?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(9999)
  publishedYear?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  language?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  coverUrl?: string;

  /**
   * Ask to fulfil this one yourself instead of queueing it for an approver. Refused without
   * `book_request_self_fulfill`; never inferred from the permission, because then every ordinary
   * request its holder made would skip the queue too.
   */
  @IsOptional()
  @IsBoolean()
  selfServe?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  providerKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  providerId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => BookRequestMetadataSourceDto)
  metadataSources?: BookRequestMetadataSourceDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(20, { each: true })
  preferredFormats?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  targetLibraryId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  targetFolderId?: number;
}
