import { useQuery } from '@tanstack/react-query'

import { queryClient } from '@/services/query-client'
import { checkUpdateSafe } from '@/services/update'

export interface UpdateInfo {
  version: string
  body: string
  date: string
  available: boolean
  checkFailed?: boolean
  downloadUrl?: string
  message?: string
  currentVersion?: string
  rawJson?: Record<string, unknown>
}

const LAST_CHECK_KEY = 'last_check_update'

export const readLastCheckTime = (): number | null => {
  const stored = localStorage.getItem(LAST_CHECK_KEY)
  if (!stored) return null
  const ts = parseInt(stored, 10)
  return isNaN(ts) ? null : ts
}

export const updateLastCheckTime = (timestamp?: number): number => {
  const now = timestamp ?? Date.now()
  localStorage.setItem(LAST_CHECK_KEY, now.toString())
  queryClient.setQueryData([LAST_CHECK_KEY], now)
  return now
}

// --- useUpdate hook ---

export const useUpdate = (_enabled: boolean = false) => {
  const shouldCheck = false

  const {
    data: updateInfo,
    refetch: checkUpdate,
    isFetching: isValidating,
  } = useQuery({
    queryKey: ['checkUpdate'],
    queryFn: async () => {
      const result = await checkUpdateSafe()
      updateLastCheckTime()
      return result
    },
    enabled: shouldCheck,
    retry: 2,
    staleTime: 60 * 60 * 1000,
    refetchInterval: false,
    refetchOnWindowFocus: false,
  })

  // Shared last check timestamp
  const { data: lastCheckUpdate } = useQuery({
    queryKey: [LAST_CHECK_KEY],
    queryFn: readLastCheckTime,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  return {
    updateInfo,
    checkUpdate,
    loading: isValidating,
    lastCheckUpdate: lastCheckUpdate ?? null,
  }
}
