import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';

import { AUDIT_EVENT } from '../../modules/audit/audit-events.service';
import { AUDITABLE_KEY } from '../decorators/auditable.decorator';
import { AuditInterceptor } from './audit.interceptor';

function makeContext(request: Record<string, unknown>): ExecutionContext {
  return {
    getHandler: vi.fn(),
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe('AuditInterceptor', () => {
  it('passes through untouched when endpoint is not auditable', async () => {
    const reflector = {
      get: vi.fn().mockReturnValue(undefined),
    };
    const auditEvents = {
      emit: vi.fn(),
    };
    const interceptor = new AuditInterceptor(reflector as never, auditEvents as never);
    const next: CallHandler = {
      handle: vi.fn().mockReturnValue(of({ ok: true })),
    };

    const response = await firstValueFrom(interceptor.intercept(makeContext({ ip: '127.0.0.1' }), next));

    expect(response).toEqual({ ok: true });
    expect(auditEvents.emit).not.toHaveBeenCalled();
  });

  it('emits audit events with user, resource id, and dynamic description', async () => {
    const reflector = {
      get: vi.fn().mockImplementation((key: string) => {
        if (key !== AUDITABLE_KEY) return undefined;
        return {
          action: 'smart_scope.create',
          resource: 'smart_scope',
          getResourceId: (_req: unknown, body: { id: number }) => body.id,
          getMeta: (_req: unknown, body: { source: string }) => ({ source: body.source }),
          description: (_req: unknown, body: { name: string }) => `Created Smart Scope ${body.name}`,
        };
      }),
    };
    const auditEvents = {
      emit: vi.fn(),
    };
    const interceptor = new AuditInterceptor(reflector as never, auditEvents as never);
    const next: CallHandler = {
      handle: vi.fn().mockReturnValue(of({ id: 22, name: 'Favorites', source: 'test' })),
    };
    const context = makeContext({
      ip: '10.0.0.8',
      user: {
        id: 7,
        username: 'reader',
      },
    });

    await firstValueFrom(interceptor.intercept(context, next));

    expect(auditEvents.emit).toHaveBeenCalledWith(AUDIT_EVENT, {
      userId: 7,
      actorUsername: 'reader',
      action: 'smart_scope.create',
      resource: 'smart_scope',
      resourceId: 22,
      description: 'Created Smart Scope Favorites',
      ip: '10.0.0.8',
      meta: { source: 'test' },
    });
  });

  it('falls back to system actor when request user is absent', async () => {
    const reflector = {
      get: vi.fn().mockReturnValue({
        action: 'system.event',
        description: 'System audit event',
      }),
    };
    const auditEvents = {
      emit: vi.fn(),
    };
    const interceptor = new AuditInterceptor(reflector as never, auditEvents as never);
    const next: CallHandler = {
      handle: vi.fn().mockReturnValue(of({})),
    };

    await firstValueFrom(interceptor.intercept(makeContext({ ip: '::1' }), next));

    expect(auditEvents.emit).toHaveBeenCalledWith(
      AUDIT_EVENT,
      expect.objectContaining({
        userId: null,
        actorUsername: 'system',
        ip: '::1',
      }),
    );
  });

  it('adds trusted app-password actor context alongside route metadata', async () => {
    const reflector = {
      get: vi.fn().mockReturnValue({
        action: 'collection.create',
        description: 'Created collection',
        getMeta: () => ({ source: 'route', actorAuth: { authMethod: 'app_password', appPasswordId: 999 } }),
      }),
    };
    const auditEvents = {
      emit: vi.fn(),
    };
    const interceptor = new AuditInterceptor(reflector as never, auditEvents as never);
    const next: CallHandler = {
      handle: vi.fn().mockReturnValue(of({ id: 1 })),
    };

    await firstValueFrom(
      interceptor.intercept(
        makeContext({
          ip: '10.0.0.9',
          user: {
            id: 7,
            username: 'reader',
            authMethod: 'app_password',
            appPasswordId: 12,
            appPasswordLabel: 'iPhone app',
          },
        }),
        next,
      ),
    );

    expect(auditEvents.emit).toHaveBeenCalledWith(
      AUDIT_EVENT,
      expect.objectContaining({
        actorAuth: {
          authMethod: 'app_password',
          appPasswordId: 12,
          appPasswordLabel: 'iPhone app',
        },
        meta: { source: 'route', actorAuth: { authMethod: 'app_password', appPasswordId: 999 } },
      }),
    );
  });

  it('does not derive app-password context from a primary request carrying spoofed fields', async () => {
    const reflector = {
      get: vi.fn().mockReturnValue({
        action: 'collection.create',
        description: 'Created collection',
      }),
    };
    const auditEvents = {
      emit: vi.fn(),
    };
    const interceptor = new AuditInterceptor(reflector as never, auditEvents as never);

    await firstValueFrom(
      interceptor.intercept(
        makeContext({
          ip: '10.0.0.9',
          user: {
            id: 7,
            username: 'reader',
            authMethod: 'primary',
            appPasswordId: 12,
            appPasswordLabel: 'spoofed',
          },
        }),
        { handle: vi.fn().mockReturnValue(of({})) },
      ),
    );

    expect(auditEvents.emit).toHaveBeenCalledWith(AUDIT_EVENT, expect.not.objectContaining({ actorAuth: expect.anything() }));
  });
});
