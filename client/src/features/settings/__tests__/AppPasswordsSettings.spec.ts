import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { AppPassword, CreateAppPasswordRequest, CreateAppPasswordResponse } from '@bookorbit/types'

const mocks = vi.hoisted(() => {
  function makeRef<T>(value: T) {
    return { value, __v_isRef: true }
  }

  return {
    appPasswords: makeRef<AppPassword[]>([]),
    loading: makeRef(false),
    loaded: makeRef(true),
    creating: makeRef(false),
    revokingId: makeRef<number | null>(null),
    loadError: makeRef(false),
    load: vi.fn<() => Promise<boolean>>(),
    create: vi.fn<(payload: CreateAppPasswordRequest) => Promise<CreateAppPasswordResponse>>(),
    revoke: vi.fn<(id: number) => Promise<void>>(),
    toastSuccess: vi.fn<(message: string) => void>(),
    toastError: vi.fn<(message: string) => void>(),
  }
})

vi.mock('../composables/useAppPasswords', () => ({
  useAppPasswords: () => ({
    appPasswords: mocks.appPasswords,
    loading: mocks.loading,
    loaded: mocks.loaded,
    creating: mocks.creating,
    revokingId: mocks.revokingId,
    loadError: mocks.loadError,
    load: mocks.load,
    create: mocks.create,
    revoke: mocks.revoke,
  }),
}))

vi.mock('vue-sonner', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}))

vi.mock('../components/CreateAppPasswordDialog.vue', () => ({
  default: {
    props: ['open', 'saving', 'error'],
    emits: ['update:open', 'submit'],
    template:
      '<div v-if="open" data-testid="create-dialog"><p v-if="error">{{ error }}</p><button data-testid="submit-create" @click="$emit(\'submit\', { label: \'KOReader on Kobo\', expiresAt: \'2027-08-25T12:00:00.000Z\' })">Submit</button></div>',
  },
}))

vi.mock('../components/AppPasswordCreatedDialog.vue', () => ({
  default: {
    props: ['open', 'label', 'password'],
    emits: ['close'],
    template:
      '<div v-if="open" data-testid="created-dialog"><span>{{ label }}</span><code>{{ password }}</code><button data-testid="close-created" @click="$emit(\'close\')">Done</button></div>',
  },
}))

import AppPasswordsSettings from '../AppPasswordsSettings.vue'

function appPassword(overrides: Partial<AppPassword> = {}): AppPassword {
  return {
    id: 1,
    label: 'KOReader on Kobo',
    hint: '2af9',
    createdAt: '2026-08-25T08:00:00.000Z',
    expiresAt: '2027-08-25T08:00:00.000Z',
    lastUsedAt: '2026-08-25T09:00:00.000Z',
    lastUsedIp: '192.0.2.10',
    activeSessions: 2,
    status: 'active',
    ...overrides,
  }
}

function mountPage() {
  return mount(AppPasswordsSettings, {
    global: {
      stubs: {
        Teleport: true,
        ConfirmDialog: {
          props: ['open', 'title', 'description', 'confirmLabel', 'busy'],
          emits: ['confirm', 'cancel'],
          template:
            '<div v-if="open" data-testid="confirm-dialog"><h2>{{ title }}</h2><p>{{ description }}</p><button data-testid="confirm-revoke" @click="$emit(\'confirm\')">{{ confirmLabel }}</button><slot /></div>',
        },
      },
    },
  })
}

describe('AppPasswordsSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.appPasswords.value = []
    mocks.loading.value = false
    mocks.loaded.value = true
    mocks.creating.value = false
    mocks.revokingId.value = null
    mocks.loadError.value = false
    mocks.load.mockResolvedValue(true)
    mocks.create.mockResolvedValue({ appPassword: appPassword(), password: 'bo_app_generated_secret' })
    mocks.revoke.mockResolvedValue(undefined)
  })

  it('loads and renders responsive credential details', async () => {
    mocks.appPasswords.value = [appPassword()]
    const wrapper = mountPage()
    await flushPromises()

    expect(mocks.load).toHaveBeenCalledOnce()
    expect(wrapper.get('[data-testid="app-passwords-table"]').text()).toContain('KOReader on Kobo')
    expect(wrapper.get('[data-testid="app-passwords-table"]').text()).toContain('192.0.2.10')
    expect(wrapper.get('[data-testid="app-passwords-table"]').text()).toContain('2')
    expect(wrapper.get('[data-testid="app-passwords-cards"]').text()).toContain('KOReader on Kobo')
  })

  it('shows the generated password once and clears it when the dialog closes', async () => {
    const wrapper = mountPage()
    await flushPromises()

    const createButton = wrapper.findAll('button').find((button) => button.text().includes('Create app password'))
    await createButton?.trigger('click')
    await wrapper.get('[data-testid="submit-create"]').trigger('click')
    await flushPromises()

    expect(mocks.create).toHaveBeenCalledWith({ label: 'KOReader on Kobo', expiresAt: '2027-08-25T12:00:00.000Z' })
    expect(wrapper.get('[data-testid="created-dialog"]').text()).toContain('bo_app_generated_secret')

    await wrapper.get('[data-testid="close-created"]').trigger('click')
    expect(wrapper.find('[data-testid="created-dialog"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('bo_app_generated_secret')
  })

  it('confirms revocation with the active session impact', async () => {
    mocks.appPasswords.value = [appPassword({ id: 7, activeSessions: 2 })]
    const wrapper = mountPage()
    await flushPromises()

    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Revoke'))
      ?.trigger('click')
    const confirmation = wrapper.get('[data-testid="confirm-dialog"]')
    expect(confirmation.text()).toContain('2 active app sessions will be signed out')

    await wrapper.get('[data-testid="confirm-revoke"]').trigger('click')
    await flushPromises()

    expect(mocks.revoke).toHaveBeenCalledWith(7)
    expect(mocks.toastSuccess).toHaveBeenCalledWith('App password revoked')
  })

  it('shows a useful empty state', async () => {
    const wrapper = mountPage()
    await flushPromises()

    expect(wrapper.get('[data-testid="app-passwords-empty"]').text()).toContain('No app passwords yet')
    expect(wrapper.get('[data-testid="app-passwords-empty"]').text()).toContain('KOReader')
  })
})
