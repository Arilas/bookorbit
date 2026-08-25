import { ref } from 'vue'
import type {
  AppPassword,
  CreateAppPasswordRequest,
  CreateAppPasswordResponse,
  RotateAppPasswordRequest,
  RotateAppPasswordResponse,
} from '@bookorbit/types'

import { api } from '@/lib/api'
import { readApiErrorDetail } from '@/lib/api-error'

async function requestError(response: Response): Promise<Error> {
  return new Error((await readApiErrorDetail(response)) ?? '')
}

export function useAppPasswords() {
  const appPasswords = ref<AppPassword[]>([])
  const loading = ref(false)
  const loaded = ref(false)
  const creating = ref(false)
  const rotatingId = ref<number | null>(null)
  const revokingId = ref<number | null>(null)
  const loadError = ref(false)

  async function load(): Promise<boolean> {
    loading.value = true
    loadError.value = false
    try {
      const response = await api('/api/v1/auth/app-passwords')
      if (!response.ok) throw await requestError(response)
      appPasswords.value = (await response.json()) as AppPassword[]
      loaded.value = true
      return true
    } catch {
      loadError.value = true
      loaded.value = false
      return false
    } finally {
      loading.value = false
    }
  }

  async function create(payload: CreateAppPasswordRequest): Promise<CreateAppPasswordResponse> {
    creating.value = true
    try {
      const response = await api('/api/v1/auth/app-passwords', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!response.ok) throw await requestError(response)

      const result = (await response.json()) as CreateAppPasswordResponse
      appPasswords.value = [result.appPassword, ...appPasswords.value.filter((entry) => entry.id !== result.appPassword.id)]
      return result
    } finally {
      creating.value = false
    }
  }

  async function rotate(id: number, payload: RotateAppPasswordRequest): Promise<RotateAppPasswordResponse> {
    rotatingId.value = id
    try {
      const response = await api(`/api/v1/auth/app-passwords/${id}/rotate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!response.ok) throw await requestError(response)

      const result = (await response.json()) as RotateAppPasswordResponse
      appPasswords.value = appPasswords.value.map((entry) => (entry.id === id ? result.appPassword : entry))
      return result
    } finally {
      rotatingId.value = null
    }
  }

  async function revoke(id: number): Promise<void> {
    revokingId.value = id
    try {
      const response = await api(`/api/v1/auth/app-passwords/${id}`, { method: 'DELETE' })
      if (!response.ok) throw await requestError(response)
      appPasswords.value = appPasswords.value.filter((entry) => entry.id !== id)
    } finally {
      revokingId.value = null
    }
  }

  return { appPasswords, loading, loaded, creating, rotatingId, revokingId, loadError, load, create, rotate, revoke }
}
