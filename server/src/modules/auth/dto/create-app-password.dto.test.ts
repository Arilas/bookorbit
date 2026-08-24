import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateAppPasswordDto } from './create-app-password.dto';

function makeDto(data: Partial<CreateAppPasswordDto>) {
  return plainToInstance(CreateAppPasswordDto, data);
}

describe('CreateAppPasswordDto', () => {
  it('accepts a named credential with an ISO expiration date', async () => {
    const errors = await validate(makeDto({ label: 'KOReader', expiresAt: '2027-01-01T00:00:00.000Z' }));
    expect(errors).toHaveLength(0);
  });

  it('requires a non-empty label', async () => {
    const errors = await validate(makeDto({ label: '', expiresAt: '2027-01-01T00:00:00.000Z' }));
    expect(errors.some(({ property }) => property === 'label')).toBe(true);
  });

  it('trims labels and rejects whitespace-only values', async () => {
    const valid = makeDto({ label: '  KOReader  ', expiresAt: '2027-01-01T00:00:00.000Z' });
    const whitespaceOnly = makeDto({ label: '   ', expiresAt: '2027-01-01T00:00:00.000Z' });

    expect(valid.label).toBe('KOReader');
    const errors = await validate(whitespaceOnly);
    expect(errors.some(({ property }) => property === 'label')).toBe(true);
  });

  it('requires an ISO expiration date', async () => {
    const errors = await validate(makeDto({ label: 'KOReader', expiresAt: 'tomorrow' }));
    expect(errors.some(({ property }) => property === 'expiresAt')).toBe(true);
  });
});
