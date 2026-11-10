import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { AuditAction, AuditResource, type AuditLogEntry } from '@bookorbit/types'

import { foldAuditEvents } from '../audit-sets'
import AuditLedgerList from '../components/AuditLedgerList.vue'

function entry(): AuditLogEntry {
  return {
    id: 1,
    userId: 1,
    actorUsername: 'reader',
    actorName: 'Reader',
    action: AuditAction.LibraryUpdate,
    resource: AuditResource.Library,
    resourceId: 88,
    description: 'Updated library #88',
    ip: '192.168.1.5',
    meta: {
      actorAuth: {
        authenticationMethod: 'app_password',
        appPasswordId: 12,
        appName: 'iPhone app',
      },
    },
    createdAt: '2026-10-14T23:07:18.000Z',
    targetLabel: 'Novels',
    targetExists: true,
  }
}

describe('AuditLedgerList', () => {
  it('shows the named App Password with its stable identity', () => {
    const wrapper = mount(AuditLedgerList, { props: { sets: foldAuditEvents([entry()]) } })

    expect(wrapper.text()).toContain('via iPhone app (app password #12)')
  })
})
