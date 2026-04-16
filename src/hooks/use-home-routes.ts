import { useLockFn } from 'ahooks'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  delayGroup,
  healthcheckProxyProvider,
} from 'tauri-plugin-mihomo-api'

import { useProfiles } from '@/hooks/use-profiles'
import { useProxySelection } from '@/hooks/use-proxy-selection'
import { useAppData } from '@/providers/app-data-context'
import delayManager from '@/services/delay'
import { showNotice } from '@/services/notice-service'

export type HomeRouteOption = {
  name: string
  record: any
  delay: number
  source: 'runtime'
  groupName?: string
  type?: string
  server?: string
  port?: number
}

type ProxyGroupOption = {
  name: string
  now: string
  all: string[]
  type?: string
}

type ProxyState = {
  proxyData: {
    groups: ProxyGroupOption[]
    records: Record<string, any>
  }
  selection: {
    group: string
    proxy: string
  }
  displayProxy: any
}

const STORAGE_KEY_GROUP = 'clash-verge-selected-proxy-group'
const STORAGE_KEY_PROXY = 'clash-verge-selected-proxy'

const normalizePolicyName = (value?: unknown) =>
  typeof value === 'string'
    ? value.trim()
    : typeof value === 'number'
      ? String(value)
      : ''

const extractName = (item: unknown) =>
  typeof item === 'string'
    ? normalizePolicyName(item)
    : normalizePolicyName((item as { name?: unknown } | null)?.name)

export const useHomeRoutes = () => {
  const { proxies, clashConfig, refreshProxy, rules } = useAppData()
  const { current: currentProfile } = useProfiles()
  const { changeProxy } = useProxySelection({
    onSuccess: () => {
      refreshProxy()
    },
    onError: (error) => {
      showNotice.error('当前线路暂时无法切换', error)
      refreshProxy()
    },
  })

  const [state, setState] = useState<ProxyState>({
    proxyData: {
      groups: [],
      records: {},
    },
    selection: {
      group: '',
      proxy: '',
    },
    displayProxy: null,
  })
  const [delayVersion, setDelayVersion] = useState(0)

  const mode = clashConfig?.mode?.toLowerCase() || 'rule'
  const isGlobalMode = mode === 'global'
  const isDirectMode = mode === 'direct'
  const currentProfileId = currentProfile?.uid || null

  const getProfileStorageKey = useCallback(
    (baseKey: string) =>
      currentProfileId ? `${baseKey}:${currentProfileId}` : baseKey,
    [currentProfileId],
  )

  const readProfileScopedItem = useCallback(
    (baseKey: string) => {
      if (typeof window === 'undefined') return null
      const profileKey = getProfileStorageKey(baseKey)
      const profileValue = localStorage.getItem(profileKey)
      if (profileValue != null) {
        return profileValue
      }

      if (profileKey !== baseKey) {
        const legacyValue = localStorage.getItem(baseKey)
        if (legacyValue != null) {
          localStorage.removeItem(baseKey)
          localStorage.setItem(profileKey, legacyValue)
          return legacyValue
        }
      }

      return null
    },
    [getProfileStorageKey],
  )

  const writeProfileScopedItem = useCallback(
    (baseKey: string, value: string) => {
      if (typeof window === 'undefined') return
      const profileKey = getProfileStorageKey(baseKey)
      localStorage.setItem(profileKey, value)
      if (profileKey !== baseKey) {
        localStorage.removeItem(baseKey)
      }
    },
    [getProfileStorageKey],
  )

  const matchPolicyName = useMemo(() => {
    if (!Array.isArray(rules)) return ''
    for (let index = rules.length - 1; index >= 0; index -= 1) {
      const rule = rules[index]
      if (!rule) continue

      if (
        typeof rule?.type === 'string' &&
        rule.type.toUpperCase() === 'MATCH'
      ) {
        const policy = normalizePolicyName(rule.proxy)
        if (policy) return policy
      }
    }
    return ''
  }, [rules])

  useEffect(() => {
    if (!proxies) return

    const getPrimaryGroupName = () => {
      if (!proxies?.groups?.length) return ''

      const primaryKeywords = [
        'auto',
        'select',
        'proxy',
        '节点选择',
        '自动选择',
      ]
      const primaryGroup =
        proxies.groups.find((group: { name: string }) =>
          primaryKeywords.some((keyword) =>
            group.name.toLowerCase().includes(keyword.toLowerCase()),
          ),
        ) ||
        proxies.groups.filter((g: { name: string }) => g.name !== 'GLOBAL')[0]

      return primaryGroup?.name || ''
    }

    const primaryGroupName = getPrimaryGroupName()

    if (isGlobalMode) {
      setState((prev) => ({
        ...prev,
        selection: {
          ...prev.selection,
          group: 'GLOBAL',
        },
      }))
    } else if (isDirectMode) {
      setState((prev) => ({
        ...prev,
        selection: {
          ...prev.selection,
          group: 'DIRECT',
        },
      }))
    } else {
      const savedGroup = readProfileScopedItem(STORAGE_KEY_GROUP)
      setState((prev) => ({
        ...prev,
        selection: {
          ...prev.selection,
          group: savedGroup || primaryGroupName || '',
        },
      }))
    }
  }, [isDirectMode, isGlobalMode, proxies, readProfileScopedItem])

  useEffect(() => {
    if (!proxies) return

    setState((prev) => {
      const groupsMap = new Map<string, ProxyGroupOption>()

      const registerGroup = (group: any, fallbackName?: string) => {
        if (!group && !fallbackName) return

        const rawName =
          typeof group?.name === 'string' && group.name.length > 0
            ? group.name
            : fallbackName
        const name = normalizePolicyName(rawName)
        if (!name || groupsMap.has(name)) return

        const rawAll = (
          Array.isArray(group?.all)
            ? (group.all as Array<string | { name?: string }>)
            : []
        ) as Array<string | { name?: string }>

        const allNames = rawAll
          .map((item) => extractName(item))
          .filter((value): value is string => value.length > 0)

        const uniqueAll = Array.from(new Set(allNames))
        if (uniqueAll.length === 0) return

        groupsMap.set(name, {
          name,
          now: normalizePolicyName(group?.now),
          all: uniqueAll,
          type: group?.type,
        })
      }

      if (matchPolicyName) {
        const matchGroup =
          proxies.groups?.find(
            (g: { name: string }) => g.name === matchPolicyName,
          ) ||
          (proxies.global?.name === matchPolicyName ? proxies.global : null) ||
          proxies.records?.[matchPolicyName]
        registerGroup(matchGroup, matchPolicyName)
      }

      ;(proxies.groups || [])
        .filter((g: { type?: string }) => g?.type === 'Selector')
        .forEach((selectorGroup: any) => registerGroup(selectorGroup))

      const filteredGroups = Array.from(groupsMap.values())

      let newProxy = ''
      let newDisplayProxy = null
      let newGroup = prev.selection.group

      if (isDirectMode) {
        newGroup = 'DIRECT'
        newProxy = 'DIRECT'
        newDisplayProxy = proxies.records?.DIRECT || { name: 'DIRECT' }
      } else if (isGlobalMode && proxies.global) {
        newGroup = 'GLOBAL'
        newProxy = proxies.global.now || ''
        newDisplayProxy = proxies.records?.[newProxy] || null
      } else {
        const currentGroup = filteredGroups.find(
          (g) => g.name === prev.selection.group,
        )

        if (!currentGroup && filteredGroups.length > 0) {
          const firstGroup = filteredGroups[0]
          if (firstGroup) {
            newGroup = firstGroup.name
            newProxy = firstGroup.now || firstGroup.all[0] || ''
            newDisplayProxy = proxies.records?.[newProxy] || null

            if (!isGlobalMode && !isDirectMode) {
              writeProfileScopedItem(STORAGE_KEY_GROUP, newGroup)
              if (newProxy) {
                writeProfileScopedItem(STORAGE_KEY_PROXY, newProxy)
              }
            }
          }
        } else if (currentGroup) {
          newProxy = currentGroup.now || currentGroup.all[0] || ''
          newDisplayProxy = proxies.records?.[newProxy] || null
        }
      }

      return {
        proxyData: {
          groups: filteredGroups,
          records: proxies.records || {},
        },
        selection: {
          group: newGroup,
          proxy: newProxy,
        },
        displayProxy: newDisplayProxy,
      }
    })
  }, [
    proxies,
    isGlobalMode,
    isDirectMode,
    writeProfileScopedItem,
    matchPolicyName,
  ])

  useEffect(() => {
    const groupName = state.selection.group
    if (!groupName || isDirectMode) return

    const notify = () => setDelayVersion((value) => value + 1)
    delayManager.setGroupListener(groupName, notify)

    return () => {
      delayManager.removeGroupListener(groupName)
    }
  }, [isDirectMode, state.selection.group])

  const routeOptions = useMemo<HomeRouteOption[]>(() => {
    const sortFromCurrentGroup = (names: string[]) =>
      names.reduce<HomeRouteOption[]>((acc, name) => {
        const normalizedName = normalizePolicyName(name)
        if (
          !normalizedName ||
          normalizedName === 'DIRECT' ||
          normalizedName === 'REJECT'
        ) {
          return acc
        }

        const record = state.proxyData.records[normalizedName] || null
        const delay =
          record && state.selection.group
            ? delayManager.getDelayFix(record, state.selection.group)
            : -1

        acc.push({
          name: normalizedName,
          record,
          delay,
          source: 'runtime',
          groupName: state.selection.group || undefined,
          type: normalizePolicyName(record?.type) || undefined,
          server: normalizePolicyName(record?.server) || undefined,
          port: typeof record?.port === 'number' ? record.port : undefined,
        })
        return acc
      }, [])

    if (isDirectMode) {
      return []
    }

    if (isGlobalMode && proxies?.global) {
      const options = proxies.global.all
        .filter((p: any) => {
          const name = typeof p === 'string' ? p : p.name
          return name !== 'DIRECT' && name !== 'REJECT'
        })
        .map((p: any) => (typeof p === 'string' ? p : p.name))

      return sortFromCurrentGroup(options)
    }

    const group = state.selection.group
      ? state.proxyData.groups.find((g) => g.name === state.selection.group)
      : null

    if (group) {
      return sortFromCurrentGroup(group.all)
    }

    return []
  }, [
    delayVersion,
    isDirectMode,
    isGlobalMode,
    proxies?.global,
    state.proxyData.groups,
    state.proxyData.records,
    state.selection.group,
  ])

  const currentNode = useMemo(
    () => state.selection.proxy || routeOptions[0]?.name || '',
    [routeOptions, state.selection.proxy],
  )

  const changeGroup = useCallback(
    (newGroup: string) => {
      if (isGlobalMode || isDirectMode) return

      writeProfileScopedItem(STORAGE_KEY_GROUP, newGroup)

      setState((prev) => {
        const group = prev.proxyData.groups.find((g) => g.name === newGroup)
        if (group) {
          return {
            ...prev,
            selection: {
              group: newGroup,
              proxy: group.now || group.all[0] || '',
            },
            displayProxy:
              prev.proxyData.records[group.now || group.all[0] || ''] || null,
          }
        }

        return {
          ...prev,
          selection: {
            ...prev.selection,
            group: newGroup,
          },
        }
      })
    },
    [isDirectMode, isGlobalMode, writeProfileScopedItem],
  )

  const primaryGroup = useMemo(() => {
    if (!state.selection.group) return null
    return (
      state.proxyData.groups.find((group) => group.name === state.selection.group) ||
      (isGlobalMode
        ? {
            name: 'GLOBAL',
            now: state.selection.proxy,
            all: routeOptions.map((item) => item.name),
            type: 'Selector',
          }
        : isDirectMode
          ? { name: 'DIRECT', now: 'DIRECT', all: ['DIRECT'] }
          : null)
    )
  }, [
    isDirectMode,
    isGlobalMode,
    routeOptions,
    state.proxyData.groups,
    state.selection.group,
    state.selection.proxy,
  ])

  const switchRoute = useLockFn(async (item: HomeRouteOption) => {
    if (isDirectMode) return false

    const newProxy = item.name
    const currentGroup = state.selection.group
    const previousProxy = state.selection.proxy

    setState((prev) => ({
      ...prev,
      selection: {
        ...prev.selection,
        proxy: newProxy,
      },
      displayProxy: prev.proxyData.records[newProxy] || null,
    }))

    if (!isGlobalMode && !isDirectMode) {
      writeProfileScopedItem(STORAGE_KEY_PROXY, newProxy)
    }

    changeProxy(
      currentGroup,
      newProxy,
      previousProxy,
      isGlobalMode || isDirectMode,
    )
    return true
  })

  const syncRouteToGlobal = useLockFn(async (routeName?: string) => {
    const targetProxy =
      normalizePolicyName(routeName) ||
      state.selection.proxy ||
      routeOptions[0]?.name ||
      ''

    if (!targetProxy) return false

    setState((prev) => ({
      ...prev,
      selection: {
        ...prev.selection,
        group: 'GLOBAL',
        proxy: targetProxy,
      },
      displayProxy: prev.proxyData.records[targetProxy] || null,
    }))

    changeProxy(
      'GLOBAL',
      targetProxy,
      normalizePolicyName(proxies?.global?.now),
      true,
    )
    return true
  })

  const selectDefaultRoute = useLockFn(async () => {
    const firstRoute = routeOptions[0]
    if (!firstRoute) return true
    return switchRoute(firstRoute)
  })

  const checkRouteDelays = useLockFn(async ({ timeout = 10000 } = {}) => {
    const groupName = state.selection.group
    if (!groupName || isDirectMode) return { testedCount: 0, successCount: 0 }

    const proxyNames: string[] = []
    const providers = new Set<string>()

    if (isGlobalMode && proxies?.global) {
      const allProxies = proxies.global.all
        .filter((p: any) => {
          const name = typeof p === 'string' ? p : p.name
          return name !== 'DIRECT' && name !== 'REJECT'
        })
        .map((p: any) => (typeof p === 'string' ? p : p.name))

      allProxies.forEach((name: string) => {
        const proxy = state.proxyData.records[name]
        if (proxy?.provider) {
          providers.add(proxy.provider)
        } else {
          proxyNames.push(name)
        }
      })
    } else {
      const group = state.proxyData.groups.find((g) => g.name === groupName)
      if (group) {
        group.all.forEach((name: string) => {
          const proxy = state.proxyData.records[name]
          if (proxy?.provider) {
            providers.add(proxy.provider)
          } else {
            proxyNames.push(name)
          }
        })
      }
    }

    if (providers.size > 0) {
      await Promise.allSettled(
        [...providers].map((provider) => healthcheckProxyProvider(provider)),
      )
    }

    if (proxyNames.length > 0) {
      const url = delayManager.getUrl(groupName)
      try {
        await Promise.race([
          delayManager.checkListDelay(proxyNames, groupName, timeout),
          delayGroup(groupName, url, timeout),
        ])
      } catch (error) {
        console.error('[useHomeRoutes] Failed to check route delays:', error)
      }
    }

    refreshProxy()
    setDelayVersion((value) => value + 1)

    let successCount = 0
    routeOptions.forEach((item) => {
      const delay = delayManager.getDelayFix(item.record, groupName)
      if (delay > 0 && delay < 1e5) {
        successCount += 1
      }
    })

    return {
      testedCount: routeOptions.length,
      successCount,
    }
  })

  return {
    changeGroup,
    checkRouteDelays,
    currentNode,
    isLoadingRoutes: false,
    primaryGroup,
    groupOptions: state.proxyData.groups,
    routeOptions,
    selectedGroupName: state.selection.group,
    selectDefaultRoute,
    syncRouteToGlobal,
    switchRoute,
  }
}
