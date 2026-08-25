import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'events';

import type { AuditAction, AuditAppPasswordActor, AuditLogMeta, AuditResource } from '@bookorbit/types';

export const AUDIT_EVENT = 'audit.log';

export interface AuditEventPayload {
  userId: number | null;
  actorUsername: string;
  action: AuditAction;
  resource?: AuditResource;
  resourceId?: number;
  description: string;
  ip?: string;
  meta?: AuditLogMeta;
  actorAuth?: AuditAppPasswordActor;
}

@Injectable()
export class AuditEventsService extends EventEmitter {}
