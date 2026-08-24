import { Permission } from '@bookorbit/types';

import { FORBIDDEN_PERMISSION_KEY } from '../../common/decorators/forbid-permission.decorator';
import { REQUIRE_PRIMARY_AUTHENTICATION_KEY } from '../../common/decorators/require-primary-authentication.decorator';
import { AppPasswordController } from './app-password.controller';

describe('AppPasswordController', () => {
  function makeController() {
    const service = {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ appPassword: {}, password: 'boap_selector_secret' }),
      revoke: vi.fn().mockResolvedValue(undefined),
    };
    return { controller: new AppPasswordController(service as never), service };
  }

  it('requires primary authentication and forbids demo-restricted users', () => {
    expect(Reflect.getMetadata(REQUIRE_PRIMARY_AUTHENTICATION_KEY, AppPasswordController)).toBe(true);
    expect(Reflect.getMetadata(FORBIDDEN_PERMISSION_KEY, AppPasswordController)).toEqual({
      permission: Permission.DemoRestricted,
      message: 'Demo-restricted account cannot edit account settings',
    });
  });

  it('rate limits credential creation to five requests per minute', () => {
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', AppPasswordController.prototype.create)).toBe(5);
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', AppPasswordController.prototype.create)).toBe(60_000);
  });

  it('scopes listing to the authenticated user', async () => {
    const { controller, service } = makeController();

    await controller.list({ id: 7 } as never);

    expect(service.list).toHaveBeenCalledWith(7);
  });

  it('scopes creation to the authenticated user and records the request IP', async () => {
    const { controller, service } = makeController();
    const user = { id: 7 } as never;
    const dto = { label: 'KOReader', expiresAt: '2027-01-01T00:00:00.000Z' };

    await controller.create(user, dto, { ip: '10.0.0.5' } as never);

    expect(service.create).toHaveBeenCalledWith(user, dto, '10.0.0.5');
  });

  it('scopes revocation to the authenticated user and credential ID', async () => {
    const { controller, service } = makeController();
    const user = { id: 7 } as never;

    await controller.revoke(user, 12, { ip: '10.0.0.6' } as never);

    expect(service.revoke).toHaveBeenCalledWith(user, 12, '10.0.0.6');
  });
});
