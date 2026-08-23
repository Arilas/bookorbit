import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListBookRequestsDto } from './list-book-requests.dto';

describe('ListBookRequestsDto', () => {
  it('transforms requester and accepts every supported status and media kind', async () => {
    const dto = plainToInstance(ListBookRequestsDto, {
      requesterUserId: '42',
      status: 'needs_review',
      mediaKind: 'audiobook',
    });

    expect(dto.requesterUserId).toBe(42);
    expect(await validate(dto)).toEqual([]);
  });

  it('rejects invalid requester, status, and media values', async () => {
    const dto = plainToInstance(ListBookRequestsDto, {
      requesterUserId: '0',
      status: 'active',
      mediaKind: 'movie',
    });

    expect((await validate(dto)).length).toBeGreaterThan(0);
  });
});
