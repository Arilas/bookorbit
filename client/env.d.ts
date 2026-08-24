/// <reference types="vite/client" />

import 'vue-router'
import type { AuthMethod, Permission, ProvisioningMethod } from '@bookorbit/types'
import type { RouteLocationNormalizedLoaded } from 'vue-router'

declare module 'vue-router' {
  interface RouteMeta {
    public?: boolean
    requiredPermission?: Permission
    forbiddenPermission?: Permission
    forbiddenAuthMethod?: AuthMethod
    forbiddenProvisioningMethod?: ProvisioningMethod
    permissionFallback?: string
    maxWidth?: string
    title?: string | ((to: RouteLocationNormalizedLoaded) => string)
  }
}
