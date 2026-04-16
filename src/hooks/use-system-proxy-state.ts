import { useQuery } from '@tanstack/react-query'
import { useRef } from 'react'
import { closeAllConnections } from 'tauri-plugin-mihomo-api'

import { useVerge } from '@/hooks/use-verge'
import { useAppData } from '@/providers/app-data-context'
import { getAutotemProxy } from '@/services/cmds'
import { queryClient } from '@/services/query-client'

export const useSystemProxyState = () => {
  const { verge, mutateVerge, patchVerge } = useVerge()
  const { sysproxy, clashConfig } = useAppData()
  const { data: autoproxy } = useQuery({
    queryKey: ['getAutotemProxy'],
    queryFn: getAutotemProxy,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })

  const {
    enable_system_proxy,
    proxy_auto_config,
    proxy_host,
    verge_mixed_port,
  } = verge ?? {}

  const indicator = (() => {
    const host = proxy_host || '127.0.0.1'
    if (proxy_auto_config) {
      if (!autoproxy?.enable) return false
      const pacPort = import.meta.env.DEV ? 11233 : 33331
      return autoproxy.url === `http://${host}:${pacPort}/commands/pac`
    }

    if (!sysproxy?.enable) return false
    const port = verge_mixed_port || clashConfig?.mixedPort || 7897
    return sysproxy.server === `${host}:${port}`
  })()

  const pendingRef = useRef<boolean | null>(null)
  const busyRef = useRef(false)

  const toggleSystemProxy = async (enabled: boolean) => {
    mutateVerge(
      (prev) => (prev ? { ...prev, enable_system_proxy: enabled } : prev),
      false,
    )
    pendingRef.current = enabled

    if (busyRef.current) return
    busyRef.current = true

    try {
      while (pendingRef.current !== null) {
        const target = pendingRef.current
        pendingRef.current = null
        if (!target && verge?.auto_close_connection) {
          await closeAllConnections().catch(() => {})
        }
        await patchVerge({ enable_system_proxy: target })
      }
    } finally {
      busyRef.current = false
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['getSystemProxy'] }),
        queryClient.invalidateQueries({ queryKey: ['getAutotemProxy'] }),
      ])
    }
  }

  const invalidateProxyState = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['getSystemProxy'] }),
      queryClient.invalidateQueries({ queryKey: ['getAutotemProxy'] }),
    ])

  return {
    indicator,
    configState: enable_system_proxy ?? false,
    toggleSystemProxy,
    invalidateProxyState,
  }
}
