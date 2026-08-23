import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { BOOK_REQUEST_MEDIA_KINDS, BOOK_REQUEST_SORT_DIRECTIONS, BOOK_REQUEST_SORT_FIELDS, BOOK_REQUEST_STATUSES } from '@bookorbit/types';
import type { BookRequestMediaKind, BookRequestSortDirection, BookRequestSortField, BookRequestStatus } from '@bookorbit/types';

export class ListBookRequestsDto {
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @IsIn(BOOK_REQUEST_STATUSES)
  status?: BookRequestStatus;

  @IsOptional()
  @IsIn(BOOK_REQUEST_MEDIA_KINDS)
  mediaKind?: BookRequestMediaKind;

  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  @Min(1)
  requesterUserId?: number;

  /** Rows the caller has hidden are left out unless they ask for them back. */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeDismissed?: boolean;

  /**
   * Ordering is a query concern, not a client one: sorting the twenty rows already fetched would
   * reorder a page rather than the list, and page 2 would disagree with page 1.
   */
  @IsOptional()
  @IsIn(BOOK_REQUEST_SORT_FIELDS)
  sortBy?: BookRequestSortField;

  @IsOptional()
  @IsIn(BOOK_REQUEST_SORT_DIRECTIONS)
  sortDir?: BookRequestSortDirection;
}
