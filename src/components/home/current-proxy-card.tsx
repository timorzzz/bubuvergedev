/* eslint-disable @eslint-react/set-state-in-effect */
import {
  AccessTimeRounded,
  ChevronRight,
  DirectionsRounded,
  LanguageRounded,
  MultipleStopRounded,
  NetworkCheckRounded,
  WifiOff as SignalError,
  SignalWifi3Bar as SignalGood,
  SignalWifi2Bar as SignalMedium,
  SignalWifi0Bar as SignalNone,
  SignalWifi4Bar as SignalStrong,
  SignalWifi1Bar as SignalWeak,
  SortByAlphaRounded,
  SortRounded,
} from '@mui/icons-material'
import {
  Box,
  Button,
  Chip,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  SelectChangeEvent,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from '@mui/material'
import { useLockFn } from 'ahooks'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import {
  closeAllConnections,
  delayGroup,
  healthcheckProxyProvider,
} from 'tauri-plugin-mihomo-api'

import { EnhancedCard } from '@/components/home/enhanced-card'
import { useProfiles } from '@/hooks/use-profiles'
import { useProxySelection } from '@/hooks/use-proxy-selection'
import { useVerge } from '@/hooks/use-verge'
import { useAppData } from '@/providers/app-data-context'
import { patchClashMode } from '@/services/cmds'
import delayManager from '@/services/delay'
import { debugLog } from '@/utils/debug'

// 本地存储的键名
const STORAGE_KEY_GROUP = 'clash-verge-selected-proxy-group'
const STORAGE_KEY_PROXY = 'clash-verge-selected-proxy'
const STORAGE_KEY_SORT_TYPE = 'clash-verge-proxy-sort-type'

const AUTO_CHECK_DEFAULT_INTERVAL_MINUTES = 5
const AUTO_CHECK_INITIAL_DELAY_MS = 100

// 代理节点信息接口
interface ProxyOption {
  name: string
}

// 排序类型: 默认 | 按延迟 | 按字母
type ProxySortType = 0 | 1 | 2
const CLASH_MODES = ['rule', 'global', 'direct'] as const
type ClashMode = (typeof CLASH_MODES)[number]


function convertDelayColor(
  delayValue: number,
): 'success' | 'warning' | 'error' | 'primary' | 'default' {
  const colorStr = delayManager.formatDelayColor(delayValue)
  if (!colorStr) return 'default'

  const mainColor = colorStr.split('.')[0]

  switch (mainColor) {
    case 'success':
      return 'success'
    case 'warning':
      return 'warning'
    case 'error':
      return 'error'
    case 'primary':
      return 'primary'
    default:
      return 'default'
  }
}

function getSignalIcon(delay: number): {
  icon: React.ReactElement
  text: string
  color: string
} {
  if (delay === -2)
    return { icon: <SignalNone />, text: '测试中', color: 'text.secondary' }
  if (delay === -1)
    return { icon: <SignalNone />, text: '未测试', color: 'text.secondary' }
  if (delay > 1e5)
    return { icon: <SignalError />, text: '错误', color: 'error.main' }
  if (delay === 0 || delay >= 10000)
    return { icon: <SignalError />, text: '超时', color: 'error.main' }
  if (delay >= 500)
    return { icon: <SignalWeak />, text: '延迟较高', color: 'error.main' }
  if (delay >= 300)
    return { icon: <SignalMedium />, text: '延迟中等', color: 'warning.main' }
  if (delay >= 200)
    return { icon: <SignalGood />, text: '延迟良好', color: 'info.main' }
  return { icon: <SignalStrong />, text: '延迟极佳', color: 'success.main' }
}

export const CurrentProxyCard = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const theme = useTheme()
  const {
    proxies,
    clashConfig,
    isCoreDataPending,
    refreshClashConfig,
    refreshProxy,
    rules,
  } = useAppData()
  const { verge } = useVerge()
  const { current: currentProfile } = useProfiles()
  const autoDelayEnabled = verge?.enable_auto_delay_detection ?? false
  const defaultLatencyTimeout = verge?.default_latency_timeout
  const autoDelayIntervalMs = useMemo(() => {
    const rawInterval = verge?.auto_delay_detection_interval_minutes
    const intervalMinutes =
      typeof rawInterval === 'number' && rawInterval > 0
        ? rawInterval
        : AUTO_CHECK_DEFAULT_INTERVAL_MINUTES
    return Math.max(1, Math.round(intervalMinutes)) * 60 * 1000
  }, [verge?.auto_delay_detection_interval_minutes])
  const currentProfileId = currentProfile?.uid || null

  const getProfileStorageKey = useCallback(
    (baseKey: string) =>
      currentProfileId ? `${baseKey}:${currentProfileId}` : baseKey,
    [currentProfileId],
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

  // 统一代理选择器
  const { handleSelectChange } = useProxySelection({
    onSuccess: () => {
      refreshProxy()
    },
    onError: (error) => {
      console.error('代理切换失败', error)
      refreshProxy()
    },
  })

  // 判断模式
  const mode = clashConfig?.mode?.toLowerCase() || 'rule'
  const isGlobalMode = mode === 'global'
  const isDirectMode = mode === 'direct'

  // Sorting type state
  const [sortType, setSortType] = useState<ProxySortType>(() => {
    const savedSortType = localStorage.getItem(STORAGE_KEY_SORT_TYPE)
    return savedSortType ? (Number(savedSortType) as ProxySortType) : 0
  })
  const [delaySortRefresh, setDelaySortRefresh] = useState(0)

  const normalizePolicyName = useCallback(
    (value?: string | null) => (typeof value === 'string' ? value.trim() : ''),
    [],
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
        if (policy) {
          return policy
        }
      }
    }
    return ''
  }, [rules, normalizePolicyName])

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

  const isLeafProxyRecord = useCallback((record: any) => {
    return !(Array.isArray(record?.all) && record.all.length > 0)
  }, [])

  const collectLeafProxyNames = useCallback(
    (
      sourceName: string,
      records: Record<string, any>,
      visited: Set<string> = new Set(),
    ): string[] => {
      const normalizedName = normalizePolicyName(sourceName)
      if (!normalizedName || visited.has(normalizedName)) return []
      visited.add(normalizedName)

      const record = records?.[normalizedName]
      if (!record) return []
      if (isLeafProxyRecord(record)) return [normalizedName]

      const children = Array.isArray(record.all)
        ? record.all
            .map((item: any) =>
              typeof item === 'string'
                ? normalizePolicyName(item)
                : normalizePolicyName(item?.name),
            )
            .filter((value: string) =>
              value && value !== 'DIRECT' && value !== 'REJECT',
            )
        : []

      return Array.from(
        new Set(
          children.flatMap((childName: string) =>
            collectLeafProxyNames(childName, records, new Set(visited)),
          ),
        ),
      )
    },
    [isLeafProxyRecord, normalizePolicyName],
  )

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

  const autoCheckInProgressRef = useRef(false)
  const latestTimeoutRef = useRef<number>(
    verge?.default_latency_timeout || 10000,
  )
  const latestProxyRecordRef = useRef<any | null>(null)

  useEffect(() => {
    latestTimeoutRef.current = verge?.default_latency_timeout || 10000
  }, [verge?.default_latency_timeout])

  useEffect(() => {
    if (!state.selection.proxy) {
      latestProxyRecordRef.current = null
      return
    }
    latestProxyRecordRef.current =
      state.proxyData.records?.[state.selection.proxy] || null
  }, [state.selection.proxy, state.proxyData.records])

  // 初始化选择的组
  useEffect(() => {
    if (!proxies) return

    const getPrimaryGroupName = () => {
      if (!proxies?.groups?.length) return ''

      const primaryKeywords = [
        '国外流量',
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

    if (isDirectMode) {
      setState((prev) => ({
        ...prev,
        selection: {
          ...prev.selection,
          group: 'DIRECT',
        },
      }))
      return
    }

    if (isGlobalMode) {
      const globalNow = normalizePolicyName(proxies?.global?.now)
      const globalNowRecord = globalNow ? proxies?.records?.[globalNow] : null
      const hiddenGroupName =
        globalNowRecord && !isLeafProxyRecord(globalNowRecord) ? globalNow : 'GLOBAL'

      setState((prev) => ({
        ...prev,
        selection: {
          ...prev.selection,
          group: hiddenGroupName,
        },
      }))
      return
    }

    setState((prev) => ({
      ...prev,
      selection: {
        ...prev.selection,
        group: primaryGroupName || '',
      },
    }))
  }, [isGlobalMode, isDirectMode, proxies, normalizePolicyName, isLeafProxyRecord])

  // 监听代理数据变化，更新状态
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
          .map((item) =>
            typeof item === 'string'
              ? normalizePolicyName(item)
              : normalizePolicyName(item?.name),
          )
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

      if (isGlobalMode) {
        const globalNow = normalizePolicyName(proxies.global?.now)
        const globalRecord = globalNow ? proxies.records?.[globalNow] : null
        if (globalNow && globalRecord && !isLeafProxyRecord(globalRecord)) {
          registerGroup(globalRecord, globalNow)
        }
      }

      const preferredGroups = (proxies.groups || []).filter((g: { name?: string; type?: string }) => g?.type === 'Selector' && `${g?.name || ''}`.includes('国外流量'))
      const selectorGroups = preferredGroups.length > 0 ? preferredGroups : (proxies.groups || []).filter((g: { type?: string }) => g?.type === 'Selector')
      selectorGroups.forEach((selectorGroup: any) => registerGroup(selectorGroup))

      const filteredGroups = Array.from(groupsMap.values())

      let newProxy = ''
      let newDisplayProxy = null
      let newGroup = prev.selection.group

      if (isDirectMode) {
        newGroup = 'DIRECT'
        newProxy = 'DIRECT'
        newDisplayProxy = proxies.records?.DIRECT || { name: 'DIRECT' }
      } else if (isGlobalMode && proxies.global) {
        const globalNow = normalizePolicyName(proxies.global.now)
        const globalRecord = globalNow ? proxies.records?.[globalNow] : null

        if (globalRecord && !isLeafProxyRecord(globalRecord)) {
          const leafNames = collectLeafProxyNames(globalNow, proxies.records || {})
          newGroup = globalNow
          newProxy = normalizePolicyName(globalRecord.now) || leafNames[0] || ''
          newDisplayProxy = proxies.records?.[newProxy] || null
        } else {
          newGroup = 'GLOBAL'
          newProxy = globalNow || ''
          newDisplayProxy = proxies.records?.[newProxy] || null
        }
      } else {
        const currentGroup = filteredGroups.find(
          (g: { name: string }) => g.name === prev.selection.group,
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
    normalizePolicyName,
    matchPolicyName,
    isLeafProxyRecord,
    collectLeafProxyNames,
  ])

  // 使用防抖包装状态更新
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const debouncedSetState = useCallback(
    (updateFn: (prev: ProxyState) => ProxyState) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
      timeoutRef.current = setTimeout(() => {
        setState(updateFn)
      }, 300)
    },
    [setState],
  )

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  // 处理代理节点变更
  const handleProxyChange = useCallback(
    (event: SelectChangeEvent<string>) => {
      if (isDirectMode) return

      const newProxy = event.target.value
      const currentGroup = state.selection.group
      const previousProxy = state.selection.proxy

      debouncedSetState((prev: ProxyState) => ({
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

      const skipConfigSave = isGlobalMode || isDirectMode
      handleSelectChange(currentGroup, previousProxy, skipConfigSave)(event)
    },
    [
      isDirectMode,
      isGlobalMode,
      state.selection,
      debouncedSetState,
      handleSelectChange,
      writeProfileScopedItem,
    ],
  )

  // 导航到代理页面
  const goToProxies = useCallback(() => {
    navigate('/proxies')
  }, [navigate])

  // 获取要显示的代理节点
  const currentProxy = useMemo(() => {
    return state.displayProxy
  }, [state.displayProxy])

  // 获取当前节点的延迟（增加非空校验）
  const currentDelay =
    currentProxy && state.selection.group
      ? delayManager.getDelayFix(currentProxy, state.selection.group)
      : -1

  // 信号图标（增加非空校验）
  const signalInfo =
    currentProxy && state.selection.group
      ? getSignalIcon(currentDelay)
      : { icon: <SignalNone />, text: '未初始化', color: 'text.secondary' }

  const checkCurrentProxyDelay = useCallback(async () => {
    if (autoCheckInProgressRef.current) return
    if (isDirectMode) return

    const groupName = state.selection.group
    const proxyName = state.selection.proxy

    if (!groupName || !proxyName) return

    const proxyRecord = latestProxyRecordRef.current
    if (!proxyRecord) {
      debugLog(
        `[CurrentProxyCard] 自动延迟检测跳过，组: ${groupName}, 节点: ${proxyName} 未找到`,
      )
      return
    }

    autoCheckInProgressRef.current = true

    const timeout = latestTimeoutRef.current || 10000

    try {
      debugLog(
        `[CurrentProxyCard] 自动检测当前节点延迟，组: ${groupName}, 节点: ${proxyName}`,
      )
      if (proxyRecord.provider) {
        await healthcheckProxyProvider(proxyRecord.provider)
      } else {
        await delayManager.checkDelay(proxyName, groupName, timeout)
      }
    } catch (error) {
      console.error(
        `[CurrentProxyCard] 自动检测当前节点延迟失败，组: ${groupName}, 节点: ${proxyName}`,
        error,
      )
    } finally {
      autoCheckInProgressRef.current = false
      refreshProxy()
      if (sortType === 1) {
        setDelaySortRefresh((prev) => prev + 1)
      }
    }
  }, [
    isDirectMode,
    refreshProxy,
    state.selection.group,
    state.selection.proxy,
    sortType,
    setDelaySortRefresh,
    isLeafProxyRecord,
  ])

  useEffect(() => {
    if (isDirectMode) return
    if (!autoDelayEnabled) return
    if (!state.selection.group || !state.selection.proxy) return

    let disposed = false
    let intervalTimer: ReturnType<typeof setTimeout> | null = null
    let initialTimer: ReturnType<typeof setTimeout> | null = null

    const runAndSchedule = async () => {
      if (disposed) return
      await checkCurrentProxyDelay()
      if (disposed) return
      intervalTimer = setTimeout(runAndSchedule, autoDelayIntervalMs)
    }

    initialTimer = setTimeout(async () => {
      await checkCurrentProxyDelay()
      if (disposed) return
      intervalTimer = setTimeout(runAndSchedule, autoDelayIntervalMs)
    }, AUTO_CHECK_INITIAL_DELAY_MS)

    return () => {
      disposed = true
      if (initialTimer) clearTimeout(initialTimer)
      if (intervalTimer) clearTimeout(intervalTimer)
    }
  }, [
    checkCurrentProxyDelay,
    autoDelayIntervalMs,
    isDirectMode,
    state.selection.group,
    state.selection.proxy,
    autoDelayEnabled,
  ])

  // 自定义渲染选择框中的值
  const renderProxyValue = (selected: string) => {
    if (!selected || !state.proxyData.records[selected]) return selected

    const delayValue = delayManager.getDelayFix(
      state.proxyData.records[selected],
      state.selection.group,
    )

    return (
      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
        <Typography noWrap>{selected}</Typography>
        <Chip
          size="small"
          label={delayManager.formatDelay(delayValue)}
          color={convertDelayColor(delayValue)}
        />
      </Box>
    )
  }

  // 排序类型变更
  const handleSortTypeChange = useCallback(() => {
    const newSortType = ((sortType + 1) % 3) as ProxySortType
    setSortType(newSortType)
    localStorage.setItem(STORAGE_KEY_SORT_TYPE, newSortType.toString())
  }, [sortType])

  // 延迟测试
  const handleCheckDelay = useLockFn(async () => {
    const groupName = state.selection.group
    if (!groupName || isDirectMode) return

    debugLog(`[CurrentProxyCard] 开始测试所有延迟，组: ${groupName}`)

    const timeout = verge?.default_latency_timeout || 10000

    // 获取当前组的所有代理
    const proxyNames: string[] = []
    const providers: Set<string> = new Set()

    if (isGlobalMode) {
      const targetGroupName = state.selection.group

      if (targetGroupName === 'GLOBAL' && proxies?.global?.all) {
        proxies.global.all
          .map((p: any) => (typeof p === 'string' ? p : p.name))
          .filter((name: string) => name && name !== 'DIRECT' && name !== 'REJECT')
          .forEach((name: string) => {
            const proxy = state.proxyData.records[name]
            if (!proxy || !isLeafProxyRecord(proxy)) return
            if (proxy?.provider) {
              providers.add(proxy.provider)
            } else {
              proxyNames.push(name)
            }
          })
      } else {
        const targetGroup = state.proxyData.groups.find(
          (g) => g.name === targetGroupName,
        )
        if (targetGroup) {
          targetGroup.all.forEach((name: string) => {
            const proxy = state.proxyData.records[name]
            if (proxy?.provider) {
              providers.add(proxy.provider)
            } else {
              proxyNames.push(name)
            }
          })
        }
      }
    } else {
      // 规则模式
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

    debugLog(
      `[CurrentProxyCard] 找到代理数量: ${proxyNames.length}, 提供者数量: ${providers.size}`,
    )

    // 测试提供者的节点
    if (providers.size > 0) {
      debugLog(`[CurrentProxyCard] 开始测试提供者节点`)
      await Promise.allSettled(
        [...providers].map((p) => healthcheckProxyProvider(p)),
      )
    }

    // 测试非提供者的节点
    if (proxyNames.length > 0) {
      const url = delayManager.getUrl(groupName)
      debugLog(`[CurrentProxyCard] 测试URL: ${url}, 超时: ${timeout}ms`)

      try {
        await Promise.race([
          delayManager.checkListDelay(proxyNames, groupName, timeout),
          delayGroup(groupName, url, timeout),
        ])
        debugLog(`[CurrentProxyCard] 延迟测试完成，组: ${groupName}`)
      } catch (error) {
        console.error(
          `[CurrentProxyCard] 延迟测试出错，组: ${groupName}`,
          error,
        )
      }
    }

    refreshProxy()
    if (sortType === 1) {
      setDelaySortRefresh((prev) => prev + 1)
    }
  })

  // 计算要显示的代理选项（增加非空校验）
  const proxyOptions = useMemo(() => {
    const sortWithLatency = (proxiesToSort: ProxyOption[]) => {
      if (!proxiesToSort || sortType === 0) return proxiesToSort

      if (!state.proxyData.records || !state.selection.group) {
        return proxiesToSort
      }

      const list = [...proxiesToSort]

      if (sortType === 1) {
        const refreshTick = delaySortRefresh
        const effectiveTimeout =
          typeof defaultLatencyTimeout === 'number' && defaultLatencyTimeout > 0
            ? defaultLatencyTimeout
            : 10000

        const categorizeDelay = (delay: number): [number, number] => {
          if (!Number.isFinite(delay)) return [5, Number.MAX_SAFE_INTEGER]
          if (delay > 1e5) return [4, delay]
          if (delay === 0 || (delay >= effectiveTimeout && delay <= 1e5)) {
            return [3, delay || effectiveTimeout]
          }
          if (delay < 0) return [5, Number.MAX_SAFE_INTEGER]
          return [0, delay]
        }

        list.sort((a, b) => {
          const recordA = state.proxyData.records[a.name]
          const recordB = state.proxyData.records[b.name]

          const [ar, av] = recordA
            ? categorizeDelay(
                delayManager.getDelayFix(recordA, state.selection.group),
              )
            : [6, Number.MAX_SAFE_INTEGER]
          const [br, bv] = recordB
            ? categorizeDelay(
                delayManager.getDelayFix(recordB, state.selection.group),
              )
            : [6, Number.MAX_SAFE_INTEGER]

          if (ar !== br) return ar - br
          if (av !== bv) return av - bv
          return refreshTick >= 0 ? a.name.localeCompare(b.name) : 0
        })
      } else {
        list.sort((a, b) => a.name.localeCompare(b.name))
      }

      return list
    }

    if (isDirectMode) {
      return [{ name: 'DIRECT' }]
    }
    if (isGlobalMode && proxies?.global) {
      if (state.selection.group && state.selection.group !== 'GLOBAL') {
        const hiddenGroup = state.proxyData.groups.find(
          (g) => g.name === state.selection.group,
        )
        if (hiddenGroup) {
          return sortWithLatency(hiddenGroup.all.map((name) => ({ name })))
        }
      }

      const options = (proxies.global.all || [])
        .map((p: any) => (typeof p === 'string' ? p : p.name))
        .filter((name: string) => name && name !== 'DIRECT' && name !== 'REJECT')
        .filter((name: string) => {
          const record = state.proxyData.records[name]
          return record ? isLeafProxyRecord(record) : false
        })
        .map((name: string) => ({ name }))

      return sortWithLatency(options)
    }

    // 规则模式
    const group = state.selection.group
      ? state.proxyData.groups.find((g) => g.name === state.selection.group)
      : null

    if (group) {
      const options = group.all.map((name) => ({ name }))
      return sortWithLatency(options)
    }

    return []
  }, [
    isDirectMode,
    isGlobalMode,
    proxies,
    state.proxyData,
    state.selection.group,
    sortType,
    delaySortRefresh,
    defaultLatencyTimeout,
    isLeafProxyRecord,
  ])

  // 获取排序图标
  const getSortIcon = (): React.ReactElement => {
    switch (sortType) {
      case 1:
        return <AccessTimeRounded fontSize="small" />
      case 2:
        return <SortByAlphaRounded fontSize="small" />
      default:
        return <SortRounded fontSize="small" />
    }
  }

  // 获取排序提示文本
  const getSortTooltip = (): string => {
    switch (sortType) {
      case 0:
        return t('proxies.page.tooltips.sortDefault')
      case 1:
        return t('proxies.page.tooltips.sortDelay')
      case 2:
        return t('proxies.page.tooltips.sortName')
      default:
        return ''
    }
  }


  const currentModeKey: ClashMode = isGlobalMode
    ? 'global'
    : isDirectMode
      ? 'direct'
      : 'rule'

  const modeDescription = useMemo(() => {
    switch (currentModeKey) {
      case 'global':
        return t('home.components.clashMode.descriptions.global')
      case 'direct':
        return t('home.components.clashMode.descriptions.direct')
      case 'rule':
      default:
        return t('home.components.clashMode.descriptions.rule')
    }
  }, [currentModeKey, t])

  const modeIconMap = useMemo<Record<ClashMode, React.ReactElement>>(
    () => ({
      rule: <MultipleStopRounded fontSize="small" />,
      global: <LanguageRounded fontSize="small" />,
      direct: <DirectionsRounded fontSize="small" />,
    }),
    [],
  )

  const onChangeMode = useLockFn(async (mode: ClashMode) => {
    if (mode === currentModeKey) return

    if (verge?.auto_close_connection) {
      closeAllConnections()
    }

    try {
      await patchClashMode(mode)
      refreshClashConfig()
      refreshProxy()
    } catch (error) {
      console.error('Failed to change mode:', error)
    }
  })

  return (
    <EnhancedCard
      title={t('home.components.currentProxy.title')}
      icon={
        <Tooltip
          title={
            currentProxy
              ? `${signalInfo.text}: ${delayManager.formatDelay(currentDelay)}`
              : '无代理节点'
          }
        >
          <Box sx={{ color: signalInfo.color }}>
            {currentProxy ? signalInfo.icon : <SignalNone color="disabled" />}
          </Box>
        </Tooltip>
      }
      iconColor={currentProxy ? 'primary' : undefined}
      action={
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Tooltip
            title={t('home.components.currentProxy.actions.refreshDelay')}
          >
            <span>
              <IconButton
                size="small"
                color="inherit"
                onClick={handleCheckDelay}
                disabled={isDirectMode}
              >
                <NetworkCheckRounded />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title={getSortTooltip()}>
            <IconButton
              size="small"
              color="inherit"
              onClick={handleSortTypeChange}
            >
              {getSortIcon()}
            </IconButton>
          </Tooltip>
          <Button
            variant="outlined"
            size="small"
            onClick={goToProxies}
            sx={{ borderRadius: 1.5 }}
            endIcon={<ChevronRight fontSize="small" />}
          >
            {t('layout.components.navigation.tabs.proxies')}
          </Button>
        </Box>
      }
    >
      {isCoreDataPending ? (
        <Box sx={{ py: 4 }} />
      ) : currentProxy ? (
        <Box>
          <Box sx={{ mb: 1.5 }}>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: 'block', mb: 0.75 }}
            >
              代理模式
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {CLASH_MODES.map((mode) => (
                <Button
                  key={mode}
                  size="small"
                  variant={mode === currentModeKey ? 'contained' : 'outlined'}
                  color={
                    mode === 'direct'
                      ? 'success'
                      : mode === 'global'
                        ? 'info'
                        : 'primary'
                  }
                  startIcon={modeIconMap[mode]}
                  onClick={() => void onChangeMode(mode)}
                  sx={{
                    borderRadius: 1.5,
                    minWidth: 0,
                    px: 1.25,
                  }}
                >
                  {mode === 'rule'
                    ? t('home.components.clashMode.labels.rule')
                    : mode === 'global'
                      ? t('home.components.clashMode.labels.global')
                      : t('home.components.clashMode.labels.direct')}
                </Button>
              ))}
            </Box>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: 'block', mt: 0.75 }}
            >
              {modeDescription}
            </Typography>
          </Box>

          {/* 代理节点信息显示 */}
          <Box
            onClick={goToProxies}
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              p: 1,
              mb: 1.5,
              cursor: 'pointer',
              borderRadius: 1,
              bgcolor: alpha(theme.palette.primary.main, 0.05),
              border: `1px solid ${alpha(theme.palette.primary.main, 0.1)}`,
            }}
          >
            <Box sx={{ minWidth: 0, pr: 1 }}>
              <Typography variant="body1" fontWeight="medium" noWrap>
                {currentProxy.name}
              </Typography>

              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 0.5,
                  mt: 0.5,
                }}
              >
                {isGlobalMode && (
                  <Chip
                    size="small"
                    label={t('home.components.currentProxy.labels.globalMode')}
                    color="primary"
                  />
                )}
                {isDirectMode && (
                  <Chip
                    size="small"
                    label={t('home.components.currentProxy.labels.directMode')}
                    color="success"
                  />
                )}
              </Box>
            </Box>

            {!isDirectMode && (
              <Chip
                size="small"
                label={delayManager.formatDelay(currentDelay)}
                color={convertDelayColor(currentDelay)}
              />
            )}
          </Box>

          {/* 代理节点选择器 */}
          <FormControl fullWidth variant="outlined" size="small" sx={{ mb: 0 }}>
            <InputLabel id="proxy-select-label">
              {t('home.components.currentProxy.labels.proxy')}
            </InputLabel>
            <Select
              labelId="proxy-select-label"
              value={state.selection.proxy}
              onChange={handleProxyChange}
              label={t('home.components.currentProxy.labels.proxy')}
              disabled={isDirectMode}
              renderValue={renderProxyValue}
              MenuProps={{
                PaperProps: {
                  style: {
                    maxHeight: 500,
                  },
                },
              }}
            >
              {isDirectMode
                ? null
                : proxyOptions.map((proxy) => {
                    const delayValue =
                      state.proxyData.records[proxy.name] &&
                      state.selection.group
                        ? delayManager.getDelayFix(
                            state.proxyData.records[proxy.name],
                            state.selection.group,
                          )
                        : -1
                    return (
                      <MenuItem
                        key={proxy.name}
                        value={proxy.name}
                        sx={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          width: '100%',
                          pr: 1,
                        }}
                      >
                        <Typography noWrap sx={{ flex: 1, mr: 1 }}>
                          {proxy.name}
                        </Typography>
                        <Chip
                          size="small"
                          label={delayManager.formatDelay(delayValue)}
                          color={convertDelayColor(delayValue)}
                          sx={{
                            minWidth: '60px',
                            height: '22px',
                            flexShrink: 0,
                          }}
                        />
                      </MenuItem>
                    )
                  })}
            </Select>
          </FormControl>
        </Box>
      ) : (
        <Box sx={{ textAlign: 'center', py: 4 }}>
          <Typography variant="body1" color="text.secondary">
            {t('home.components.currentProxy.labels.noActiveNode')}
          </Typography>
        </Box>
      )}
    </EnhancedCard>
  )
}
