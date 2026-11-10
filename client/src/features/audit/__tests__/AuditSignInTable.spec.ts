import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { AuditSignInGroup } from '@bookorbit/types'

import AuditSignInTable from '../components/AuditSignInTable.vue'

function group(appPasswordId: number, appName: string | null): AuditSignInGroup {
  return {
    day: '2026-10-15',
    actorUsername: 'reader',
    actorName: 'Reader',
    userId: 2,
    actorAuth: { authenticationMethod: 'app_password', appPasswordId, appName },
    ip: '192.168.8.230',
    signIns: 1,
    signOuts: 0,
    failed: 0,
    failedUsernames: [],
    firstAt: '2026-10-16T01:49:37.000Z',
    lastAt: '2026-10-16T01:49:37.000Z',
  }
}

describe('AuditSignInTable', () => {
  it('keeps duplicate app names distinguishable and renders the id fallback', () => {
    const wrapper = mount(AuditSignInTable, { props: { groups: [group(7, 'Reader'), group(8, 'Reader'), group(9, null)] } })

    expect(wrapper.text()).toContain('via Reader (app password #7)')
    expect(wrapper.text()).toContain('via Reader (app password #8)')
    expect(wrapper.text()).toContain('via App password #9')
  })
})
