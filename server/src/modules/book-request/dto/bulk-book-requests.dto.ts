import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsInt, Min } from 'class-validator';
import { BOOK_REQUEST_BULK_LIMIT } from '@bookorbit/types';

/**
 * Deliberately ids only. Bulk approval takes each request's own destination; rerouting a library
 * is a judgement about one book, and applying one reroute to a whole selection is not something
 * the approver can have meant.
 */
export class BulkBookRequestsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(BOOK_REQUEST_BULK_LIMIT)
  @IsInt({ each: true })
  @Min(1, { each: true })
  ids!: number[];
}
