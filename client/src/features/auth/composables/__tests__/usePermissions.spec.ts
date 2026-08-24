import { describe, expect, it, beforeEach, vi } from 'vitest'
import { Permission } from '@bookorbit/types'
import { usePermissions } from '../usePermissions'

let currentUser: {
  isSuperuser?: boolean
  permissions?: string[]
  authMethod?: 'primary' | 'app_password'
  provisioningMethod?: 'local' | 'shared'
} | null = null

vi.mock('../useAuth', () => ({
  useAuth: () => ({
    user: {
      get value() {
        return currentUser
      },
    },
  }),
}))

describe('usePermissions', () => {
  beforeEach(() => {
    currentUser = null
  })

  it('returns false permissions and marker flags for anonymous state', () => {
    const { hasPermission, hasExplicitPermission, isDemoRestrictedAccount, isSuperuser, userPermissions, authMethod, provisioningMethod } =
      usePermissions()

    expect(hasPermission(Permission.LibraryDownload)).toBe(false)
    expect(hasExplicitPermission(Permission.LibraryDownload)).toBe(false)
    expect(isDemoRestrictedAccount.value).toBe(false)
    expect(isSuperuser.value).toBe(false)
    expect(userPermissions.value).toEqual([])
    expect(authMethod.value).toBeUndefined()
    expect(provisioningMethod.value).toBeUndefined()
  })

  it('grants permission checks for explicit user permissions', () => {
    currentUser = { isSuperuser: false, permissions: [Permission.LibraryDownload, Permission.DemoRestricted] }
    const { hasPermission, hasExplicitPermission, isDemoRestrictedAccount } = usePermissions()

    expect(hasPermission(Permission.LibraryDownload)).toBe(true)
    expect(hasExplicitPermission(Permission.LibraryDownload)).toBe(true)
    expect(isDemoRestrictedAccount.value).toBe(true)
  })

  it('keeps explicit checks strict even for superusers', () => {
    currentUser = { isSuperuser: true, permissions: [] }
    const { hasPermission, hasExplicitPermission, isDemoRestrictedAccount } = usePermissions()

    expect(hasPermission(Permission.ManageUsers)).toBe(true)
    expect(hasExplicitPermission(Permission.ManageUsers)).toBe(false)
    expect(isDemoRestrictedAccount.value).toBe(false)
  })

  it('exposes how the current session authenticated', () => {
    currentUser = { isSuperuser: false, permissions: [], authMethod: 'app_password' }

    expect(usePermissions().authMethod.value).toBe('app_password')
  })

  it('exposes how the account was provisioned', () => {
    currentUser = { isSuperuser: false, permissions: [], provisioningMethod: 'shared' }

    expect(usePermissions().provisioningMethod.value).toBe('shared')
  })
})
