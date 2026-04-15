import { useLockFn } from 'ahooks'
import yaml from 'js-yaml'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { useProfiles } from '@/hooks/use-profiles'
import { useProxySelection } from '@/hooks/use-proxy-selection'
import { useAppData } from '@/providers/app-data-context'
import {
  getProfiles,
  getRuntimeYaml,
  patchProfile,
  pingHosts,
  readProfileFile,
  syncTrayProxySelection,
} from '@/services/cmds'
import delayManager from '@/services/delay'
import { showNotice } from '@/services/notice-service'

export type HomeRouteOption = {
  name: string
  record: any
  delay: number
  source: 'yaml' | 'runtime'
  groupName?: string
  type?: string
  server?: string
  port?: number
}

export type HomeRouteDebugInfo = {
  action: string
  targetRoute: string
  candidateGroups: string[]
  appliedSelections: Array<{ name: string; now: string }>
  primaryGroup: string
  primaryNow: string
  globalNow: string
  savedSelections: Array<{ name: string; now: string }>
}

type ParsedYamlProxy = {
  name?: unknown
  type?: unknown
  server?: unknown
  port?: unknown
}

type ParsedYamlGroup = {
  name?: unknown
  type?: unknown
  proxies?: unknown
}

const SELECTABLE_GROUP_TYPES = new Set([
  'Selector',
  'URLTest',
  'Fallback',
  'LoadBalance',
])

const YAML_SELECTABLE_GROUP_TYPES = new Set([
  'select',
  'url-test',
  'fallback',
  'load-balance',
])

const PRESET_ROUTE_NAMES = new Set([
  'DIRECT',
  'REJECT',
  'REJECT-DROP',
  'PASS',
  'COMPATIBLE',
])

const normalizeLabel = (value: unknown) => {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number') return String(value)
  if (value && typeof value === 'object' && 'name' in value) {
    const nested = (value as { name?: unknown }).name
    return typeof nested === 'string' ? nested.trim() : String(nested ?? '')
  }
  return String(value ?? '').trim()
}

const extractNameList = (value: unknown) => {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => normalizeLabel(item))
    .filter((item) => item.length > 0 && !PRESET_ROUTE_NAMES.has(item))
}

const pickPrimaryGroup = (proxies: any) => {
  const groups = Array.isArray(proxies?.groups) ? proxies.groups : []
  const selectors = groups.filter((group: any) => group?.type === 'Selector')
  if (!selectors.length) return groups[0] ?? null

  const preferredKeywords = [
    'free',
    'auto',
    'select',
    'proxy',
    '鑺傜偣',
    '鍥藉',
  ]
  const preferred = selectors.find((group: any) =>
    preferredKeywords.some((keyword) =>
      String(group?.name || '')
        .toLowerCase()
        .includes(keyword.toLowerCase()),
    ),
  )
  return preferred ?? selectors[0]
}

const parseYamlRouteData = (content?: string | null) => {
  if (!content) {
    return { routes: [] as ParsedYamlProxy[], groupNames: [] as string[] }
  }

  try {
    const parsed = yaml.load(content) as
      | {
          proxies?: ParsedYamlProxy[]
          'proxy-groups'?: ParsedYamlGroup[]
        }
      | undefined

    const routes = Array.isArray(parsed?.proxies)
      ? parsed.proxies.reduce<ParsedYamlProxy[]>((acc, item) => {
          const name = normalizeLabel(item?.name)
          if (
            !name ||
            PRESET_ROUTE_NAMES.has(name) ||
            acc.some((route) => normalizeLabel(route.name) === name)
          ) {
            return acc
          }
          acc.push(item)
          return acc
        }, [])
      : []

    const groupNames = Array.isArray(parsed?.['proxy-groups'])
      ? parsed['proxy-groups']
          .filter(
            (group) =>
              YAML_SELECTABLE_GROUP_TYPES.has(
                normalizeLabel(group?.type).toLowerCase(),
              ) && extractNameList(group?.proxies).length > 0,
          )
          .map((group) => normalizeLabel(group?.name))
          .filter(Boolean)
      : []

    return { routes, groupNames }
  } catch (error) {
    console.warn('[useHomeRoutes] Failed to parse profile yaml routes:', error)
    return { routes: [] as ParsedYamlProxy[], groupNames: [] as string[] }
  }
}

const mergeYamlRouteData = (
  ...sources: Array<{ routes: ParsedYamlProxy[]; groupNames: string[] }>
) => {
  const routeMap = new Map<string, ParsedYamlProxy>()
  const groupNames: string[] = []

  for (const source of sources) {
    for (const route of source.routes) {
      const name = normalizeLabel(route?.name)
      if (!name || routeMap.has(name)) continue
      routeMap.set(name, route)
    }

    for (const groupName of source.groupNames) {
      const normalized = normalizeLabel(groupName)
      if (!normalized || groupNames.includes(normalized)) continue
      groupNames.push(normalized)
    }
  }

  return {
    routes: Array.from(routeMap.values()),
    groupNames,
  }
}

const collectLeafProxyNames = (
  proxyName: string,
  records: Record<string, any>,
  visited = new Set<string>(),
): string[] => {
  const normalized = normalizeLabel(proxyName)
  if (!normalized || visited.has(normalized)) return []

  visited.add(normalized)
  const record = records?.[normalized]
  if (!record?.all?.length) return normalized ? [normalized] : []

  return extractNameList(record.all).flatMap((name) =>
    collectLeafProxyNames(name, records, new Set(visited)),
  )
}

const findCarrierGroupName = (
  groupName: string,
  targetRouteName: string,
  records: Record<string, any>,
) => {
  const groupRecord = records[groupName]
  const groupAll = extractNameList(groupRecord?.all)

  if (!groupAll.length) return ''
  if (groupAll.includes(targetRouteName)) return targetRouteName

  return (
    groupAll.find((candidate) =>
      collectLeafProxyNames(candidate, records).includes(targetRouteName),
    ) || ''
  )
}

const dedupeSelections = (
  selections: Array<{ name: string; now: string }>,
): Array<{ name: string; now: string }> => {
  const map = new Map<string, { name: string; now: string }>()

  for (const item of selections) {
    const groupName = normalizeLabel(item.name)
    const routeName = normalizeLabel(item.now)
    if (!groupName || !routeName) continue
    map.set(groupName, { name: groupName, now: routeName })
  }

  return Array.from(map.values())
}

export const useHomeRoutes = () => {
  const { current: currentProfile } = useProfiles()
  const { proxies, refreshProxy } = useAppData()
  const { changeProxyAsync } = useProxySelection()

  const [yamlRoutes, setYamlRoutes] = useState<ParsedYamlProxy[]>([])
  const [yamlGroupNames, setYamlGroupNames] = useState<string[]>([])
  const [delayVersion, setDelayVersion] = useState(0)
  const [isLoadingRoutes, setIsLoadingRoutes] = useState(false)
  const [debugInfo, setDebugInfo] = useState<HomeRouteDebugInfo | null>(null)

  useEffect(() => {
    let alive = true

    if (!currentProfile?.uid) {
      setYamlRoutes([])
      setYamlGroupNames([])
      setIsLoadingRoutes(false)
      return () => {
        alive = false
      }
    }

    setIsLoadingRoutes(true)

    void Promise.allSettled([
      getRuntimeYaml(),
      readProfileFile(currentProfile.uid),
    ])
      .then((results) => {
        if (!alive) return

        const runtimeYaml =
          results[0].status === 'fulfilled' ? results[0].value : null
        const profileYaml =
          results[1].status === 'fulfilled' ? results[1].value : null

        const merged = mergeYamlRouteData(
          parseYamlRouteData(runtimeYaml),
          parseYamlRouteData(profileYaml),
        )

        setYamlRoutes(merged.routes)
        setYamlGroupNames(merged.groupNames)
        setIsLoadingRoutes(false)
      })
      .catch((error) => {
        if (!alive) return
        console.warn(
          '[useHomeRoutes] Failed to read current profile file:',
          error,
        )
        setYamlRoutes([])
        setYamlGroupNames([])
        setIsLoadingRoutes(false)
      })

    return () => {
      alive = false
    }
  }, [currentProfile?.uid, currentProfile?.updated])

  const primaryGroup = useMemo(() => pickPrimaryGroup(proxies), [proxies])

  const preferredGroupNames = useMemo(
    () =>
      Array.from(
        new Set(
          [normalizeLabel(primaryGroup?.name), ...yamlGroupNames].filter(
            Boolean,
          ),
        ),
      ),
    [primaryGroup?.name, yamlGroupNames],
  )

  const resolveRuntimeGroupForRoute = useCallback(
    (routeName: string, preferredNames: string[] = []) => {
      const groups = Array.isArray(proxies?.groups) ? proxies.groups : []
      const selectableGroups = groups.filter((group: any) =>
        SELECTABLE_GROUP_TYPES.has(group?.type),
      )

      const containsRoute = (group: any) =>
        extractNameList(group?.all).some((name) => name === routeName)

      for (const preferredName of preferredNames) {
        const matched = selectableGroups.find(
          (group: any) =>
            normalizeLabel(group?.name) === preferredName &&
            containsRoute(group),
        )
        if (matched) return matched
      }

      return selectableGroups.find(containsRoute) ?? null
    },
    [proxies?.groups],
  )

  const runtimeRouteOptions = useMemo<HomeRouteOption[]>(() => {
    const records = proxies?.records || {}
    const runtimeLeafProxies: any[] = Array.isArray(proxies?.proxies)
      ? proxies.proxies
      : []

    return runtimeLeafProxies.reduce((acc: HomeRouteOption[], proxy: any) => {
      const name = normalizeLabel(proxy?.name)
      if (!name || PRESET_ROUTE_NAMES.has(name)) {
        return acc
      }

      const record = records[name] || proxy
      const matchedGroup = resolveRuntimeGroupForRoute(
        name,
        preferredGroupNames,
      )
      const delayGroupName =
        normalizeLabel(matchedGroup?.name) || normalizeLabel(primaryGroup?.name)
      const delay =
        record && delayGroupName
          ? delayManager.getDelayFix(record, delayGroupName)
          : -1

      acc.push({
        name,
        record,
        delay,
        source: 'runtime' as const,
        groupName: normalizeLabel(matchedGroup?.name) || undefined,
      })
      return acc
    }, [])
  }, [
    delayVersion,
    preferredGroupNames,
    primaryGroup?.name,
    proxies?.proxies,
    proxies?.records,
    resolveRuntimeGroupForRoute,
  ])

  const yamlRouteOptions = useMemo<HomeRouteOption[]>(() => {
    const records = proxies?.records || {}

    return yamlRoutes.reduce<HomeRouteOption[]>((acc, route) => {
      const name = normalizeLabel(route.name)
      if (!name) return acc

      const group = resolveRuntimeGroupForRoute(name, preferredGroupNames)
      const record = records[name]
      const delayGroupName =
        normalizeLabel(group?.name) || normalizeLabel(primaryGroup?.name)
      const delay =
        record && delayGroupName
          ? delayManager.getDelayFix(record, delayGroupName)
          : -1

      acc.push({
        name,
        record,
        delay,
        source: 'yaml' as const,
        groupName: normalizeLabel(group?.name) || undefined,
        type: normalizeLabel(route.type) || undefined,
        server: normalizeLabel(route.server) || undefined,
        port:
          typeof route.port === 'number'
            ? route.port
            : typeof route.port === 'string' && route.port
              ? Number(route.port)
              : undefined,
      })
      return acc
    }, [])
  }, [
    delayVersion,
    yamlRoutes,
    proxies?.records,
    preferredGroupNames,
    primaryGroup?.name,
    resolveRuntimeGroupForRoute,
  ])

  const routeOptions = useMemo(() => {
    const merged = new Map<string, HomeRouteOption>()

    for (const item of yamlRouteOptions) {
      merged.set(item.name, item)
    }

    for (const item of runtimeRouteOptions) {
      const existing = merged.get(item.name)
      if (!existing) {
        merged.set(item.name, item)
        continue
      }

      merged.set(item.name, {
        ...item,
        ...existing,
        record: existing.record || item.record,
        delay:
          existing.delay && existing.delay > 0 ? existing.delay : item.delay,
        groupName: existing.groupName || item.groupName,
      })
    }

    return Array.from(merged.values())
  }, [delayVersion, runtimeRouteOptions, yamlRouteOptions])

  const routeDelayGroups = useMemo(
    () =>
      Array.from(
        new Set(
          routeOptions
            .map((item) => normalizeLabel(item.groupName))
            .concat(normalizeLabel(primaryGroup?.name))
            .filter(Boolean),
        ),
      ),
    [primaryGroup?.name, routeOptions],
  )

  useEffect(() => {
    if (!routeDelayGroups.length) return

    const notify = () => {
      setDelayVersion((value) => value + 1)
    }

    routeDelayGroups.forEach((groupName) => {
      delayManager.setGroupListener(groupName, notify)
    })

    return () => {
      routeDelayGroups.forEach((groupName) => {
        delayManager.removeGroupListener(groupName)
      })
    }
  }, [routeDelayGroups])

  const savedSelectedRoute = useMemo(() => {
    const selectedEntries = Array.isArray(currentProfile?.selected)
      ? currentProfile.selected
      : []
    if (!selectedEntries.length || !routeOptions.length) return ''

    const matchesRouteOption = (routeName: string) =>
      routeOptions.some((item) => item.name === routeName)

    const primaryGroupName = normalizeLabel(primaryGroup?.name)
    const exactPrimaryMatch = selectedEntries.find((entry) => {
      const groupName = normalizeLabel(entry?.name)
      const routeName = normalizeLabel(entry?.now)
      return (
        groupName === primaryGroupName &&
        routeName &&
        matchesRouteOption(routeName)
      )
    })

    if (exactPrimaryMatch) {
      return normalizeLabel(exactPrimaryMatch.now)
    }

    const preferredGroupSet = new Set(preferredGroupNames.map(normalizeLabel))
    const preferredMatch = selectedEntries.find((entry) => {
      const groupName = normalizeLabel(entry?.name)
      const routeName = normalizeLabel(entry?.now)
      return (
        preferredGroupSet.has(groupName) &&
        routeName &&
        matchesRouteOption(routeName)
      )
    })

    return normalizeLabel(preferredMatch?.now)
  }, [currentProfile?.selected, preferredGroupNames, primaryGroup?.name, routeOptions])

  const currentNode = useMemo(
    () => normalizeLabel(savedSelectedRoute || primaryGroup?.now || routeOptions[0]?.name),
    [primaryGroup?.now, routeOptions, savedSelectedRoute],
  )

  const buildDebugInfo = useCallback(
    (
      action: string,
      targetRoute: string,
      candidateGroups: string[],
      appliedSelections: Array<{ name: string; now: string }>,
    ): HomeRouteDebugInfo => ({
      action,
      targetRoute: normalizeLabel(targetRoute),
      candidateGroups: candidateGroups.map(normalizeLabel).filter(Boolean),
      appliedSelections: appliedSelections.map((item) => ({
        name: normalizeLabel(item.name),
        now: normalizeLabel(item.now),
      })),
      primaryGroup: normalizeLabel(primaryGroup?.name),
      primaryNow: normalizeLabel(primaryGroup?.now),
      globalNow: normalizeLabel(proxies?.global?.now),
      savedSelections: (Array.isArray(currentProfile?.selected)
        ? currentProfile.selected
        : []
      ).map((item) => ({
        name: normalizeLabel(item?.name),
        now: normalizeLabel(item?.now),
      })),
    }),
    [currentProfile?.selected, primaryGroup?.name, primaryGroup?.now, proxies?.global?.now],
  )

  const persistGroupSelections = useCallback(
    async (changes: Array<{ name: string; now: string }>) => {
      if (!currentProfile || !changes.length) return

      const latestProfiles = await getProfiles().catch(() => null)
      const latestCurrentProfile =
        latestProfiles?.items?.find(
          (item) => item && item.uid === currentProfile.uid,
        ) || currentProfile

      const selected = Array.isArray(latestCurrentProfile.selected)
        ? [...latestCurrentProfile.selected]
        : []

      for (const change of changes) {
        const groupName = normalizeLabel(change.name)
        const routeName = normalizeLabel(change.now)
        if (!groupName || !routeName) continue

        const index = selected.findIndex(
          (item) => normalizeLabel(item?.name) === groupName,
        )

        if (index < 0) {
          selected.push({ name: groupName, now: routeName })
        } else {
          selected[index] = { name: groupName, now: routeName }
        }
      }

      await patchProfile(currentProfile.uid!, { selected })
    },
    [currentProfile],
  )

  const switchToRoute = useCallback(
    async (item: HomeRouteOption) => {
      const records = proxies?.records || {}
      const selectableGroupNames = (Array.isArray(proxies?.groups)
        ? proxies.groups
        : []
      )
        .filter((group: any) => SELECTABLE_GROUP_TYPES.has(group?.type))
        .map((group: any) => normalizeLabel(group?.name))
        .filter(Boolean)

      const syncRouteThroughGroup = async (
        groupName: string,
        routeName: string,
        appliedSelections: Array<{ name: string; now: string }>,
      ): Promise<boolean> => {
        const normalizedGroupName = normalizeLabel(groupName)
        const normalizedRouteName = normalizeLabel(routeName)
        if (!normalizedGroupName || !normalizedRouteName) return false

        const groupRecord = records[normalizedGroupName]
        const groupNow = normalizeLabel(groupRecord?.now)
        const nextHop = findCarrierGroupName(
          normalizedGroupName,
          normalizedRouteName,
          records,
        )

        if (!nextHop) return false

        if (
          !appliedSelections.some(
            (item) => normalizeLabel(item.name) === normalizedGroupName,
          )
        ) {
          appliedSelections.push({
            name: normalizedGroupName,
            now: nextHop,
          })
        }

        if (groupNow !== nextHop) {
          await changeProxyAsync(
            normalizedGroupName,
            nextHop,
            groupNow,
            true,
            { silent: true },
          )
        }

        if (nextHop === normalizedRouteName) {
          return true
        }

        return syncRouteThroughGroup(
          nextHop,
          normalizedRouteName,
          appliedSelections,
        )
      }

      const candidateRootGroups = Array.from(
        new Set(
          [
            normalizeLabel(primaryGroup?.name),
            normalizeLabel(item.groupName),
            ...preferredGroupNames.map(normalizeLabel),
            ...selectableGroupNames.filter((groupName: string) =>
              Boolean(findCarrierGroupName(groupName, item.name, records)),
            ),
          ].filter(Boolean),
        ),
      )

      let syncedAnyGroup = false
      const allAppliedSelections: Array<{ name: string; now: string }> = []
      for (const rootGroupName of candidateRootGroups) {
        const appliedSelections: Array<{ name: string; now: string }> = []
        try {
          const synced = await syncRouteThroughGroup(
            rootGroupName,
            item.name,
            appliedSelections,
          )
          if (synced) {
            allAppliedSelections.push(...appliedSelections)
            syncedAnyGroup = true
          }
        } catch (error) {
          console.warn(
            `[useHomeRoutes] Failed to sync route through group ${rootGroupName}:`,
            error,
          )
        }
      }

      if (syncedAnyGroup) {
        const dedupedSelections = dedupeSelections(allAppliedSelections)
        if (dedupedSelections.length) {
          await persistGroupSelections(dedupedSelections)
        }
        await syncTrayProxySelection().catch(() => {})
        setDebugInfo(
          buildDebugInfo(
            'switch-route',
            item.name,
            candidateRootGroups,
            dedupedSelections,
          ),
        )
        await refreshProxy()
        return true
      }

      const targetGroup = resolveRuntimeGroupForRoute(item.name, [
        item.groupName || '',
        ...preferredGroupNames,
      ])

      if (!targetGroup) {
        showNotice.info('当前线路暂时无法切换')
        return false
      }

      const previousProxy = normalizeLabel(targetGroup.now)
      if (previousProxy === item.name) {
        const directSelections = [{ name: targetGroup.name, now: item.name }]
        await persistGroupSelections(directSelections)
        await syncTrayProxySelection().catch(() => {})
        setDebugInfo(
          buildDebugInfo(
            'switch-route-direct-hit',
            item.name,
            [targetGroup.name],
            directSelections,
          ),
        )
        return true
      }

      try {
        await changeProxyAsync(targetGroup.name, item.name, previousProxy, true, {
          silent: true,
        })
        const directSelections = [{ name: targetGroup.name, now: item.name }]
        await persistGroupSelections(directSelections)
        await syncTrayProxySelection().catch(() => {})
        setDebugInfo(
          buildDebugInfo(
            'switch-route-direct',
            item.name,
            [targetGroup.name],
            directSelections,
          ),
        )
        await refreshProxy()
        return true
      } catch (error) {
        setDebugInfo(
          buildDebugInfo('switch-route-failed', item.name, [targetGroup.name], []),
        )
        await refreshProxy()
        showNotice.error('?????????', error)
        return false
      }
    },
    [
      buildDebugInfo,
      changeProxyAsync,
      primaryGroup?.name,
      proxies?.records,
      persistGroupSelections,
      preferredGroupNames,
      refreshProxy,
      resolveRuntimeGroupForRoute,
    ],
  )

  const switchRoute = useLockFn(async (item: HomeRouteOption) => {
    return switchToRoute(item)
  })

  const syncRouteToGlobal = useLockFn(async (routeName?: string) => {
    const targetRouteName = normalizeLabel(
      routeName || currentNode || routeOptions[0]?.name,
    )
    const globalAll = extractNameList(proxies?.global?.all)
    const records = proxies?.records || {}
    const globalNow = normalizeLabel(proxies?.global?.now)

    if (!targetRouteName || !globalAll.length) {
      return false
    }

    if (globalAll.includes(targetRouteName)) {
      if (globalNow !== targetRouteName) {
        await changeProxyAsync('GLOBAL', targetRouteName, globalNow, true, {
          silent: true,
        })
        await persistGroupSelections([{ name: 'GLOBAL', now: targetRouteName }])
      }
      await syncTrayProxySelection().catch(() => {})
      await refreshProxy()
      return true
    }

    const carrierGroupName = globalAll.find((candidate) =>
      collectLeafProxyNames(candidate, records).includes(targetRouteName),
    )

    if (!carrierGroupName) {
      return false
    }

    if (globalNow !== carrierGroupName) {
      await changeProxyAsync('GLOBAL', carrierGroupName, globalNow, true, {
        silent: true,
      })
    }

    const carrierRecord = records[carrierGroupName]
    const previousProxy = normalizeLabel(carrierRecord?.now)
    const selectionsToPersist: Array<{ name: string; now: string }> = [
      { name: 'GLOBAL', now: carrierGroupName },
    ]
    if (
      carrierRecord?.all?.length &&
      previousProxy &&
      previousProxy !== targetRouteName
    ) {
      await changeProxyAsync(
        carrierGroupName,
        targetRouteName,
        previousProxy,
        true,
        { silent: true },
      )
      selectionsToPersist.push({ name: carrierGroupName, now: targetRouteName })
    } else if (carrierRecord?.all?.length && !previousProxy) {
      await changeProxyAsync(carrierGroupName, targetRouteName, '', true, {
        silent: true,
      })
      selectionsToPersist.push({ name: carrierGroupName, now: targetRouteName })
    }

    await persistGroupSelections(selectionsToPersist)
    await syncTrayProxySelection().catch(() => {})
    await refreshProxy()
    return true
  })

  const selectDefaultRoute = useLockFn(async () => {
    const firstRoute = routeOptions[0]
    if (!firstRoute) return true
    return switchToRoute(firstRoute)
  })

  const checkRouteDelays = useLockFn(
    async ({ timeout = 10000, rounds = 3 } = {}) => {
      if (!routeOptions.length) {
        return { testedCount: 0, successCount: 0 }
      }

      const groupedRoutes = routeOptions.reduce<Map<string, string[]>>(
        (map, item) => {
          const groupName =
            normalizeLabel(item.groupName) || normalizeLabel(primaryGroup?.name)
          if (!groupName) return map

          const existing = map.get(groupName) || []
          if (!existing.includes(item.name)) {
            existing.push(item.name)
            map.set(groupName, existing)
          }
          return map
        },
        new Map(),
      )

      if (!groupedRoutes.size) {
        return { testedCount: routeOptions.length, successCount: 0 }
      }

      const totalRounds = Math.max(1, Math.min(rounds, 3))
      const aggregated = new Map<string, number[]>()

      for (let round = 0; round < totalRounds; round += 1) {
        await Promise.all(
          Array.from(groupedRoutes.entries()).map(
            async ([groupName, names]) => {
              await delayManager.checkListDelay(names, groupName, timeout)

              names.forEach((name) => {
                const delay = delayManager.getDelay(name, groupName)
                if (delay > 0 && delay < 1e5) {
                  const key = `${groupName}::${name}`
                  const samples = aggregated.get(key) || []
                  samples.push(delay)
                  aggregated.set(key, samples)
                }
              })
            },
          ),
        )

        if (round < totalRounds - 1) {
          await new Promise((resolve) => setTimeout(resolve, 150))
        }
      }

      let successCount = 0

      groupedRoutes.forEach((names, groupName) => {
        names.forEach((name) => {
          const key = `${groupName}::${name}`
          const samples = aggregated.get(key) || []
          if (!samples.length) return

          const bestDelay = Math.min(...samples)
          delayManager.setDelay(name, groupName, bestDelay)
          successCount += 1
        })
      })

      setDelayVersion((value) => value + 1)

      return {
        testedCount: routeOptions.length,
        successCount,
      }
    },
  )

  const checkYamlRoutePingDelays = useLockFn(
    async ({ timeout = 1500, rounds = 3 } = {}) => {
      const pingableRoutes = routeOptions.reduce<
        Array<{ name: string; host: string; groupName: string }>
      >((acc, item) => {
        const host =
          normalizeLabel(item.server) ||
          normalizeLabel(item.record?.server) ||
          ''
        const groupName =
          normalizeLabel(item.groupName) || normalizeLabel(primaryGroup?.name)

        if (!host || !groupName) return acc

        acc.push({
          name: item.name,
          host,
          groupName,
        })
        return acc
      }, [])

      if (!pingableRoutes.length) {
        return { testedCount: 0, successCount: 0 }
      }

      const pingResults: Record<string, number> = await pingHosts(
        Array.from(new Set(pingableRoutes.map((item) => item.host))),
        timeout,
        rounds,
      ).catch((error) => {
        console.error('[useHomeRoutes] Failed to ping YAML routes:', error)
        return {} as Record<string, number>
      })

      let successCount = 0

      pingableRoutes.forEach((item) => {
        const delay = pingResults[item.host]
        if (typeof delay === 'number' && delay > 0) {
          delayManager.setDelay(item.name, item.groupName, delay)
          successCount += 1
          return
        }

        delayManager.setDelay(item.name, item.groupName, 0)
      })

      setDelayVersion((value) => value + 1)

      return {
        testedCount: pingableRoutes.length,
        successCount,
      }
    },
  )

  return {
    debugInfo,
    checkRouteDelays,
    checkYamlRoutePingDelays,
    currentNode,
    currentProfileUid: currentProfile?.uid || '',
    isYamlSource: yamlRouteOptions.length > 0,
    isLoadingRoutes,
    primaryGroup,
    routeOptions,
    selectDefaultRoute,
    syncRouteToGlobal,
    switchRoute,
  }
}
