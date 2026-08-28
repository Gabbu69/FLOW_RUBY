import { getLunaraNativeBridge } from './bridge'
import { isNative } from './runtime'

export type BiometricKind =
  | 'face'
  | 'fingerprint'
  | 'iris'
  | 'device-credential'
  | 'biometric-or-device-credential'
  | 'none'

export type BiometricState =
  | 'available'
  | 'not-enrolled'
  | 'locked-out'
  | 'unavailable'
  | 'unsupported'

export interface BiometricStatus {
  available: boolean
  enrolled: boolean
  kind: BiometricKind
  state: BiometricState
  reason?: string
}

export interface BiometricAuthenticationResult {
  authenticated: boolean
  kind: BiometricKind
  errorCode?: string
}

interface LunaraNativeBiometricPlugin {
  biometricStatus(): Promise<BiometricStatus>
  authenticate(options: { reason: string }): Promise<BiometricAuthenticationResult>
}

const LunaraNative = getLunaraNativeBridge<LunaraNativeBiometricPlugin>()

export async function getBiometricStatus(): Promise<BiometricStatus> {
  if (!isNative) {
    return {
      available: false,
      enrolled: false,
      kind: 'none',
      state: 'unsupported',
      reason: 'Biometric app unlock is available in the installed iOS and Android apps.',
    }
  }

  return LunaraNative.biometricStatus()
}

export async function authenticateWithBiometrics(
  reason = 'Unlock your private Ruby data',
): Promise<BiometricAuthenticationResult> {
  if (!isNative) {
    return { authenticated: false, kind: 'none', errorCode: 'WEB_UNSUPPORTED' }
  }

  const trimmedReason = reason.trim().slice(0, 160)
  if (!trimmedReason) throw new Error('An authentication reason is required.')

  return LunaraNative.authenticate({ reason: trimmedReason })
}
