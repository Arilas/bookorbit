import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { RotateAppPasswordDto } from './rotate-app-password.dto';

describe('RotateAppPasswordDto', () => {
  it('accepts an ISO expiration date', async () => {
    const errors = await validate(plainToInstance(RotateAppPasswordDto, { expiresAt: '2027-01-01T00:00:00.000Z' }));

    expect(errors).toHaveLength(0);
  });

  it('requires an ISO expiration date', async () => {
    const errors = await validate(plainToInstance(RotateAppPasswordDto, { expiresAt: 'next year' }));

    expect(errors.some(({ property }) => property === 'expiresAt')).toBe(true);
  });
});
