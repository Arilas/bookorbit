import { auditActorAuthFromUser } from './audit-actor-auth.utils';
import { makeUser } from '../test-utils/make-user';

describe('auditActorAuthFromUser', () => {
  it('derives audit attribution from a trusted app-password request user', () => {
    expect(
      auditActorAuthFromUser(
        makeUser({
          authMethod: 'app_password',
          appPasswordId: 42,
          appPasswordLabel: 'iPhone app',
        }),
      ),
    ).toEqual({
      authMethod: 'app_password',
      appPasswordId: 42,
      appPasswordLabel: 'iPhone app',
    });
  });

  it('retains the credential id when a legacy request user has no label', () => {
    expect(auditActorAuthFromUser(makeUser({ authMethod: 'app_password', appPasswordId: 42 }))).toEqual({
      authMethod: 'app_password',
      appPasswordId: 42,
      appPasswordLabel: null,
    });
  });

  it.each([
    undefined,
    makeUser({ authMethod: 'primary', appPasswordId: 42, appPasswordLabel: 'spoofed' }),
    makeUser({ authMethod: 'app_password', appPasswordId: undefined }),
    makeUser({ authMethod: 'app_password', appPasswordId: 0 }),
    makeUser({ authMethod: 'app_password', appPasswordId: 1.5 }),
  ])('does not attribute primary, missing, or invalid credential context', (user) => {
    expect(auditActorAuthFromUser(user)).toBeUndefined();
  });
});
