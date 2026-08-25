import type { AuditAppPasswordActor } from '@bookorbit/types';

import type { RequestUser } from '../types/request-user';

export function auditActorAuthFromUser(user: RequestUser | undefined): AuditAppPasswordActor | undefined {
  const appPasswordId = user?.appPasswordId;
  if (
    user?.authenticationMethod !== 'app_password' ||
    typeof appPasswordId !== 'number' ||
    !Number.isSafeInteger(appPasswordId) ||
    appPasswordId <= 0
  ) {
    return undefined;
  }

  return {
    authenticationMethod: 'app_password',
    appPasswordId,
    appName: user.appPasswordName ?? null,
  };
}
