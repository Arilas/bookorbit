import { auditActorAuthFromUser } from './audit-actor-auth.utils';
import { makeUser } from '../test-utils/make-user';

describe('auditActorAuthFromUser', () => {
  it('derives audit attribution from a trusted app-password request user', () => {
    expect(
      auditActorAuthFromUser(
        makeUser({
          authenticationMethod: 'app_password',
          appPasswordId: 42,
          appPasswordName: 'iPhone app',
        }),
      ),
    ).toEqual({
      authenticationMethod: 'app_password',
      appPasswordId: 42,
      appName: 'iPhone app',
    });
  });

  it('retains the credential id when the trusted request context has no name', () => {
    expect(auditActorAuthFromUser(makeUser({ authenticationMethod: 'app_password', appPasswordId: 42 }))).toEqual({
      authenticationMethod: 'app_password',
      appPasswordId: 42,
      appName: null,
    });
  });

  it.each([
    undefined,
    makeUser({ authenticationMethod: 'password', appPasswordId: 42, appPasswordName: 'spoofed' }),
    makeUser({ authenticationMethod: 'app_password', appPasswordId: undefined }),
    makeUser({ authenticationMethod: 'app_password', appPasswordId: 0 }),
    makeUser({ authenticationMethod: 'app_password', appPasswordId: 1.5 }),
  ])('does not attribute primary, missing, or invalid credential context', (user) => {
    expect(auditActorAuthFromUser(user)).toBeUndefined();
  });
});
