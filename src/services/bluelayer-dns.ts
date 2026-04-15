import { invoke } from '@tauri-apps/api/core'

import { showNotice } from '@/services/notice-service'

let autoEnabledThisRuntime = false

export async function maybeAutoEnableDnsOverwrite(
  enabled: boolean | undefined,
  apply: (value: boolean) => Promise<void>,
) {
  if (enabled || autoEnabledThisRuntime) return false

  const ok = await invoke<boolean>('probe_connectivity').catch(() => false)
  if (!ok) return false

  await apply(true)
  autoEnabledThisRuntime = true
  showNotice.success('覆写DNS 已自动开启')
  return true
}

export function resetAutoEnableDnsRuntimeFlag() {
  autoEnabledThisRuntime = false
}
