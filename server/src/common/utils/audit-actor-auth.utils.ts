import type { AuditAppPasswordActor } from '@bookorbit/types';

import type { RequestUser } from '../types/request-user';

export function auditActorAuthFromUser(user: RequestUser | undefined): AuditAppPasswordActor | undefined {
  const appPasswordId = user?.appPasswordId;
  if (user?.authMethod !== 'app_password' || typeof appPasswordId !== 'number' || !Number.isSafeInteger(appPasswordId) || appPasswordId <= 0) {
    return undefined;
  }

  return {
    authMethod: 'app_password',
    appPasswordId,
    appPasswordLabel: user.appPasswordLabel ?? null,
  };
}
