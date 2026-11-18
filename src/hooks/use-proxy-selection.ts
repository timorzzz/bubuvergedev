import { useCallback, useMemo, useRef } from 'react'
import {
  closeConnection,
  getConnections,
  selectNodeForGroup,
} from 'tauri-plugin-mihomo-api'

import { useVerge } from '@/hooks/use-verge'
import { getMihomoProxies, getProfiles, patchProfile, syncTrayProxySelection } from '@/services/cmds'
import { debugLog } from '@/utils/debug'

const cleanupConnections = async (previousProxy: string) => {
  try {
    const { connections } = await getConnections()
    const cleanupPromises = (connections ?? [])
      .filter((conn) => conn.chains.includes(previousProxy))
      .map((conn) => closeConnection(conn.id))

    if (cleanupPromises.length > 0) {
      await Promise.allSettled(cleanupPromises)
      debugLog(
        `[ProxySelection] cleaned ${cleanupPromises.length} connections for ${previousProxy}`,
      )
    }
  } catch (error) {
    console.warn('[ProxySelection] failed to cleanup connections:', error)
  }
}

interface ProxySelectionOptions {
  onSuccess?: () => void
  onError?: (error: any) => void
  enableConnectionCleanup?: boolean
}

interface ProxyChangeRequest {
  groupName: string
  proxyName: string
  previousProxy?: string
  skipConfigSave: boolean
  resolve: (success: boolean) => void
}

export const useProxySelection = (options: ProxySelectionOptions = {}) => {
  const { verge } = useVerge()
  const pendingRequestRef = useRef<ProxyChangeRequest | null>(null)
  const isProcessingRef = useRef(false)

  const { onSuccess, onError, enableConnectionCleanup = true } = options

  const config = useMemo(
    () => ({
      autoCloseConnection: verge?.auto_close_connection ?? false,
      enableConnectionCleanup,
    }),
    [verge?.auto_close_connection, enableConnectionCleanup],
  )

  const syncTraySelection = useCallback(() => {
    syncTrayProxySelection().catch((error) => {
      console.error('[ProxySelection] failed to sync tray selection:', error)
    })
  }, [])

  const persistSelection = useCallback(
    async (groupName: string, proxyName: string, skipConfigSave: boolean) => {
      if (skipConfigSave) return
      // Merge against the latest profile so another group's choice is not lost.
      const profiles = await getProfiles()
      const current = profiles.items?.find((item) => item.uid === profiles.current)
      if (!current) return

      const selected = current.selected ? [...current.selected] : []
      const index = selected.findIndex((item) => item.name === groupName)

      if (index < 0) {
        selected.push({ name: groupName, now: proxyName })
      } else {
        selected[index] = { name: groupName, now: proxyName }
      }

      await patchProfile(current.uid, { selected })
    },
    [],
  )

  const executeChange = useCallback(
    async (request: ProxyChangeRequest) => {
      const { groupName, proxyName, previousProxy, skipConfigSave } = request
      debugLog(`[ProxySelection] switching ${groupName} -> ${proxyName}`)

      try {
        await selectNodeForGroup(groupName, proxyName)
        const confirmed = await getMihomoProxies()
        if (confirmed.proxies[groupName]?.now !== proxyName) {
          throw new Error('内核未确认线路切换，请刷新后重试')
        }
        try {
          await persistSelection(groupName, proxyName, skipConfigSave)
        } catch (error) {
          onError?.(error)
        }
        onSuccess?.()
        syncTraySelection()

        if (
          config.enableConnectionCleanup &&
          config.autoCloseConnection &&
          previousProxy
        ) {
          setTimeout(() => cleanupConnections(previousProxy), 0)
        }
        return true
      } catch (error) {
        console.error(
          `[ProxySelection] failed to switch ${groupName} -> ${proxyName}`,
          error,
        )

        onError?.(error)
        return false
      }
    },
    [config, onError, onSuccess, persistSelection, syncTraySelection],
  )

  const flushChangeQueue = useCallback(async () => {
    if (isProcessingRef.current) return
    isProcessingRef.current = true

    try {
      while (pendingRequestRef.current) {
        const request = pendingRequestRef.current
        pendingRequestRef.current = null
        try {
          request.resolve(await executeChange(request))
        } catch {
          request.resolve(false)
        }
      }
    } finally {
      isProcessingRef.current = false
      if (pendingRequestRef.current) {
        void flushChangeQueue()
      }
    }
  }, [executeChange])

  const changeProxy = useCallback(
    (
      groupName: string,
      proxyName: string,
      previousProxy?: string,
      skipConfigSave: boolean = false,
    ): Promise<boolean> => new Promise((resolve) => {
      // A superseded queued choice must also settle its caller.
      pendingRequestRef.current?.resolve(false)
      pendingRequestRef.current = {
        groupName,
        proxyName,
        previousProxy,
        skipConfigSave,
        resolve,
      }
      void flushChangeQueue()
    }),
    [flushChangeQueue],
  )

  const handleSelectChange = useCallback(
    (
      groupName: string,
      previousProxy?: string,
      skipConfigSave: boolean = false,
    ) =>
      (event: { target: { value: string } }) => {
        const newProxy = event.target.value
        changeProxy(groupName, newProxy, previousProxy, skipConfigSave)
      },
    [changeProxy],
  )

  const handleProxyGroupChange = useCallback(
    (group: { name: string; now?: string }, proxy: { name: string }) => {
      changeProxy(group.name, proxy.name, group.now)
    },
    [changeProxy],
  )

  return {
    changeProxy,
    handleSelectChange,
    handleProxyGroupChange,
  }
}
