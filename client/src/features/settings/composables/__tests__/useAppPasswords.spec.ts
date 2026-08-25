import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppPassword, CreateAppPasswordResponse } from '@bookorbit/types'

import { useAppPasswords } from '../useAppPasswords'

const apiMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>()

vi.mock('@/lib/api', () => ({
  api: (input: string, init?: RequestInit) => apiMock(input, init),
}))

function response(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as Response
}

function appPassword(overrides: Partial<AppPassword> = {}): AppPassword {
  return {
    id: 1,
    label: 'KOReader on Kobo',
    hint: '2af9',
    createdAt: '2026-08-25T08:00:00.000Z',
    expiresAt: '2027-08-25T08:00:00.000Z',
    lastUsedAt: null,
    lastUsedIp: null,
    activeSessions: 0,
    status: 'active',
    ...overrides,
  }
}

describe('useAppPasswords', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads the current user app passwords', async () => {
    apiMock.mockResolvedValue(response([appPassword()]))
    const state = useAppPasswords()

    await expect(state.load()).resolves.toBe(true)

    expect(apiMock).toHaveBeenCalledWith('/api/v1/auth/app-passwords', undefined)
    expect(state.appPasswords.value).toEqual([appPassword()])
    expect(state.loaded.value).toBe(true)
    expect(state.loading.value).toBe(false)
  })

  it('creates a credential with the exact API payload and prepends its summary', async () => {
    const created: CreateAppPasswordResponse = { appPassword: appPassword({ id: 2, label: 'BookOrbit mobile' }), password: 'generated-secret' }
    apiMock.mockResolvedValue(response(created))
    const state = useAppPasswords()
    state.appPasswords.value = [appPassword()]
    const payload = { label: 'BookOrbit mobile', expiresAt: '2027-08-25T08:00:00.000Z' }

    await expect(state.create(payload)).resolves.toEqual(created)

    expect(apiMock).toHaveBeenCalledWith('/api/v1/auth/app-passwords', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    expect(state.appPasswords.value.map((entry) => entry.id)).toEqual([2, 1])
    expect(state.creating.value).toBe(false)
  })

  it('rotates a credential with the selected expiry and replaces only that summary', async () => {
    const rotated: CreateAppPasswordResponse = {
      appPassword: appPassword({
        id: 2,
        hint: '91cd',
        expiresAt: '2027-11-23T08:00:00.000Z',
        activeSessions: 0,
      }),
      password: 'replacement-secret',
    }
    apiMock.mockResolvedValue(response(rotated))
    const state = useAppPasswords()
    state.appPasswords.value = [appPassword({ id: 1 }), appPassword({ id: 2, hint: 'old2' })]
    const payload = { expiresAt: '2027-11-23T08:00:00.000Z' }

    await expect(state.rotate(2, payload)).resolves.toEqual(rotated)

    expect(apiMock).toHaveBeenCalledWith('/api/v1/auth/app-passwords/2/rotate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    expect(state.appPasswords.value).toEqual([appPassword({ id: 1 }), rotated.appPassword])
    expect(state.rotatingId.value).toBeNull()
  })

  it('revokes a credential and removes only that row', async () => {
    apiMock.mockResolvedValue(response(undefined))
    const state = useAppPasswords()
    state.appPasswords.value = [appPassword({ id: 1 }), appPassword({ id: 2 })]

    await state.revoke(2)

    expect(apiMock).toHaveBeenCalledWith('/api/v1/auth/app-passwords/2', { method: 'DELETE' })
    expect(state.appPasswords.value.map((entry) => entry.id)).toEqual([1])
    expect(state.revokingId.value).toBeNull()
  })

  it('keeps stable load state and surfaces mutation details on failures', async () => {
    apiMock.mockResolvedValue(response({ message: 'Credential limit reached' }, false))
    const state = useAppPasswords()

    await expect(state.load()).resolves.toBe(false)
    expect(state.loadError.value).toBe(true)
    expect(state.loaded.value).toBe(false)
    expect(state.loading.value).toBe(false)

    await expect(state.create({ label: 'KOReader', expiresAt: '2027-08-25T08:00:00.000Z' })).rejects.toThrow('Credential limit reached')
    expect(state.creating.value).toBe(false)

    await expect(state.rotate(1, { expiresAt: '2027-08-25T08:00:00.000Z' })).rejects.toThrow('Credential limit reached')
    expect(state.rotatingId.value).toBeNull()

    await expect(state.revoke(1)).rejects.toThrow('Credential limit reached')
    expect(state.revokingId.value).toBeNull()
  })
})
