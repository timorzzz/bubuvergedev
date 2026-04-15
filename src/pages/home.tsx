import {
  PowerSettingsNewRounded,
  RefreshRounded,
  SecurityRounded,
  ShieldRounded,
} from '@mui/icons-material'
import {
  Box,
  Chip,
  CircularProgress,
  IconButton,
  Stack,
  Tooltip,
  Typography,
  useMediaQuery,
  alpha,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { useLockFn } from 'ahooks'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { closeAllConnections } from 'tauri-plugin-mihomo-api'

import { BasePage } from '@/components/base'
import { useTrafficData } from '@/hooks/use-traffic-data'
import { HomeRouteOption, useHomeRoutes } from '@/hooks/use-home-routes'
import { useProfiles } from '@/hooks/use-profiles'
import { useSystemState } from '@/hooks/use-system-state'
import { useSystemProxyState } from '@/hooks/use-system-proxy-state'
import { useVerge } from '@/hooks/use-verge'
import { useAppData } from '@/providers/app-data-context'
import { getIpInfo } from '@/services/api'
import { refreshBluelayerSubscription, useBluelayerState } from '@/services/bluelayer'
import { showNotice } from '@/services/notice-service'
import {
  getProfiles,
  installService,
  logHomeRouteDebug,
  patchClashMode,
} from '@/services/cmds'
import { debugLog } from '@/utils/debug'

let preparedLatencySessionKey = ''
type PublicIpSnapshot = Awaited<ReturnType<typeof getIpInfo>>

const normalizeLabel = (value: unknown) => {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number') return String(value)
  if (value && typeof value === 'object' && 'name' in value) {
    const nested = (value as { name?: unknown }).name
    return typeof nested === 'string' ? nested.trim() : String(nested ?? '')
  }
  return String(value ?? '').trim()
}

const resolveLeafProxyName = (
  proxyName: unknown,
  records?: Record<string, any>,
  visited = new Set<string>(),
): string => {
  const normalized = normalizeLabel(proxyName)
  if (!normalized || visited.has(normalized)) return normalized

  visited.add(normalized)
  const record = records?.[normalized]
  if (!record?.all?.length) return normalized

  return resolveLeafProxyName(
    normalizeLabel(record.now) || normalizeLabel(record.all?.[0]),
    records,
    visited,
  )
}

const formatTraffic = (value?: number) => {
  if (!value || value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let index = 0
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024
    index += 1
  }
  return `${size.toFixed(index === 0 ? 0 : 2)} ${units[index]}`
}

const formatTrafficSpeed = (value?: number) => `${formatTraffic(value)}/s`

const getRouteCountryCode = (name: string) => {
  const prefix = normalizeLabel(name)
    .split(/[\s_-]+/)
    .find(Boolean)
    ?.replace(/[^A-Za-z]/g, '')
    .toUpperCase()

  if (!prefix) return ''

  const aliasMap: Record<string, string> = {
    UK: 'GB',
    USA: 'US',
    KOR: 'KR',
    JPN: 'JP',
    GER: 'DE',
    HKG: 'HK',
    TWN: 'TW',
  }

  if (aliasMap[prefix]) return aliasMap[prefix]
  if (prefix.length >= 2) return prefix.slice(0, 2)
  return ''
}

const getCountryFlagUrl = (countryCode: string) => {
  if (!/^[A-Z]{2}$/.test(countryCode)) return ''
  return `https://flagcdn.com/w40/${countryCode.toLowerCase()}.png`
}

const formatDelayLabel = (delay: number) => {
  if (delay === -2) return '测速中'
  if (delay > 0 && delay < 1e5) return `${Math.round(delay)} ms`
  if (delay === 0 || delay >= 1e5) return '超时'
  return '--'
}

const getDelayTone = (delay: number) => {
  if (delay > 0 && delay <= 120) return 'good'
  if (delay > 120 && delay <= 260) return 'medium'
  return 'poor'
}

const RouteFlag = ({
  countryCode,
  compact,
  isLight,
}: {
  countryCode: string
  compact: boolean
  isLight: boolean
}) => {
  const [failed, setFailed] = useState(false)
  const normalizedCode = /^[A-Z]{2}$/.test(countryCode) ? countryCode : ''
  const size = compact ? 34 : 38

  useEffect(() => {
    setFailed(false)
  }, [normalizedCode])

  if (!normalizedCode || failed) {
    return (
      <Box
        sx={{
          width: size,
          height: size,
          borderRadius: '50%',
          display: 'grid',
          placeItems: 'center',
          flexShrink: 0,
          fontSize: compact ? 11 : 12,
          fontWeight: 900,
          letterSpacing: 0.4,
          color: isLight ? '#7f5600' : '#ffd18b',
          background: isLight
            ? 'rgba(255,245,230,0.9)'
            : 'rgba(255,255,255,0.08)',
          border: isLight
            ? '1px solid rgba(31,24,16,0.08)'
            : '1px solid rgba(255,255,255,0.08)',
        }}
      >
        {normalizedCode || '节点'}
      </Box>
    )
  }

  return (
    <Box
      sx={{
        width: size,
        height: size,
        borderRadius: '50%',
        overflow: 'hidden',
        flexShrink: 0,
        display: 'grid',
        placeItems: 'center',
        background: isLight ? 'rgba(255,245,230,0.9)' : 'rgba(255,255,255,0.08)',
        border: isLight
          ? '1px solid rgba(31,24,16,0.08)'
          : '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <Box
        component="img"
        src={getCountryFlagUrl(normalizedCode)}
        alt={normalizedCode}
        onError={() => setFailed(true)}
        sx={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          display: 'block',
        }}
      />
    </Box>
  )
}

const HomePage = () => {
  const theme = useTheme()
  const denseHome = useMediaQuery('(max-width:960px), (max-height:760px)')
  const compactHome = useMediaQuery('(max-width:860px), (max-height:680px)')
  const lowResHome = useMediaQuery('(max-width:980px), (max-height:620px)')
  const tinyHome = useMediaQuery('(max-width:840px), (max-height:560px)')
  const isLight = theme.palette.mode === 'light'
  const { activateSelected } = useProfiles()
  const { verge, patchVerge } = useVerge()
  const { isTunModeAvailable, mutateSystemState } = useSystemState()
  const { session } = useBluelayerState()
  const {
    clashConfig,
    proxies,
    refreshClashConfig,
    refreshProxy,
    systemProxyAddress,
  } = useAppData()
  const {
    checkYamlRoutePingDelays,
    currentNode: routeCurrentNode,
    currentProfileUid,
    debugInfo: routeDebugInfo,
    isLoadingRoutes,
    primaryGroup,
    routeOptions,
    syncRouteToGlobal,
    switchRoute,
  } = useHomeRoutes()
  const {
    indicator: systemProxyIndicator,
    configState: systemProxyConfigState,
    toggleSystemProxy,
  } = useSystemProxyState()

  const latencySessionKey = currentProfileUid
    ? `${currentProfileUid}:${session?.createdAt ?? 0}`
    : ''
  const [isRouteLatencyReady, setIsRouteLatencyReady] = useState(
    preparedLatencySessionKey === latencySessionKey && Boolean(latencySessionKey),
  )
  const [isRetestingLatency, setIsRetestingLatency] = useState(false)
  const [isRefreshingRoutes, setIsRefreshingRoutes] = useState(false)
  const [isInstallingTunService, setIsInstallingTunService] = useState(false)
  const [isTogglingProtection, setIsTogglingProtection] = useState(false)
  const [preferredRouteName, setPreferredRouteName] = useState('')

  const user = session?.userInfo
  const remainingTraffic = Math.max(
    (user?.traffic?.total || 0) - (user?.traffic?.used || 0),
    0,
  )
  const packageExpireAt = user?.class_expire || '未设置'

  useEffect(() => {
    if (!latencySessionKey) {
      setIsRouteLatencyReady(false)
      return
    }

    if (preparedLatencySessionKey === latencySessionKey) {
      setIsRouteLatencyReady(true)
      return
    }

    if (isLoadingRoutes || !routeOptions.length) {
      setIsRouteLatencyReady(false)
      return
    }

    let alive = true
    setIsRouteLatencyReady(false)

    const timer = window.setTimeout(() => {
      void (async () => {
        await checkYamlRoutePingDelays({
          timeout: Math.min(verge?.default_latency_timeout || 1500, 2500),
          rounds: 3,
        })

        if (!alive) return

        preparedLatencySessionKey = latencySessionKey
        setIsRouteLatencyReady(true)
      })()
    }, 150)

    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [
    checkYamlRoutePingDelays,
    isLoadingRoutes,
    latencySessionKey,
    routeOptions.length,
    verge?.default_latency_timeout,
  ])

  const currentNode = normalizeLabel(
    primaryGroup?.now || routeCurrentNode || routeOptions[0]?.name || '未选择线路',
  )
  const currentMode =
    clashConfig?.mode?.toLowerCase() === 'global' ? 'global' : 'rule'
  const activeRouteName =
    currentMode === 'global'
      ? resolveLeafProxyName(proxies?.global?.now, proxies?.records)
      : currentNode

  const activeRoute = useMemo(
    () =>
      routeOptions.find((item) => item.name === preferredRouteName) ||
      routeOptions.find((item) => item.name === activeRouteName) ||
      routeOptions.find((item) => item.name === currentNode) ||
      routeOptions[0],
    [activeRouteName, currentNode, preferredRouteName, routeOptions],
  )

  useEffect(() => {
    if (!routeOptions.length) {
      if (preferredRouteName) setPreferredRouteName('')
      return
    }

    if (
      preferredRouteName &&
      routeOptions.some((item) => item.name === preferredRouteName)
    ) {
      return
    }

    const fallbackRouteName = normalizeLabel(
      activeRouteName || currentNode || routeOptions[0]?.name,
    )
    if (fallbackRouteName && fallbackRouteName !== preferredRouteName) {
      setPreferredRouteName(fallbackRouteName)
    }
  }, [activeRouteName, currentNode, preferredRouteName, routeOptions])

  const isProtected =
    Boolean(verge?.enable_tun_mode) ||
    systemProxyIndicator ||
    systemProxyConfigState
  const { response: trafficResponse } = useTrafficData({ enabled: isProtected })
  const isPreparingRoutes =
    isLoadingRoutes || (routeOptions.length > 0 && !isRouteLatencyReady)
  const [publicIpInfo, setPublicIpInfo] = useState<PublicIpSnapshot | null>(null)
  const [isCheckingPublicIp, setIsCheckingPublicIp] = useState(false)
  const [publicIpSummary, setPublicIpSummary] = useState(
    '连接后将自动检测外网 IP 是否变更',
  )
  const [hasInitialIpCheck, setHasInitialIpCheck] = useState(false)
  const uploadSpeed = trafficResponse.data?.up ?? 0
  const downloadSpeed = trafficResponse.data?.down ?? 0

  const resolvePreferredRoute = useCallback(
    (explicitRouteName?: string) => {
      const targetRouteName = normalizeLabel(
        explicitRouteName ||
          preferredRouteName ||
          activeRouteName ||
          currentNode ||
          routeOptions[0]?.name,
      )

      return {
        targetRouteName,
        targetRoute:
          routeOptions.find((item) => item.name === targetRouteName) ||
          routeOptions[0],
      }
    },
    [activeRouteName, currentNode, preferredRouteName, routeOptions],
  )

  const restorePreferredRoute = useLockFn(
    async (targetMode: 'rule' | 'global', explicitRouteName?: string) => {
      const { targetRouteName, targetRoute } =
        resolvePreferredRoute(explicitRouteName)

      if (!targetRouteName) return false

      if (targetMode === 'global') {
        return syncRouteToGlobal(targetRouteName)
      }

      if (!targetRoute) return false
      return switchRoute(targetRoute)
    },
  )

  const reapplySavedSelections = useLockFn(async () => {
    for (const waitMs of [200, 700, 1400]) {
      if (waitMs > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, waitMs))
      }

      try {
        const latestProfiles = await getProfiles()
        await activateSelected(latestProfiles)
        await refreshProxy()
        return true
      } catch (error) {
        debugLog('[HomeRouteDebug] failed to reapply saved selections', error)
      }
    }

    return false
  })

  const refreshPublicIp = useLockFn(async (notifyOnError = true) => {
    setIsCheckingPublicIp(true)
    try {
      const nextInfo = await getIpInfo()
      setPublicIpInfo(nextInfo)
      setPublicIpSummary('连接后将自动检测外网 IP 是否变更')
      return nextInfo
    } catch (error) {
      setPublicIpSummary('当前外网 IP 检测失败，可稍后重试')
      if (notifyOnError) {
        showNotice.error('当前外网 IP 检测失败', error)
      }
      return null
    } finally {
      setIsCheckingPublicIp(false)
    }
  })

  const verifyPublicIpChange = useLockFn(async (beforeIp?: string) => {
    setPublicIpSummary('正在校验连接后的外网 IP')

    let latestInfo: PublicIpSnapshot | null = null
    for (const waitMs of [1400, 2400]) {
      await new Promise((resolve) => window.setTimeout(resolve, waitMs))
      latestInfo = (await refreshPublicIp(false)) ?? null
      if (latestInfo?.ip && beforeIp && latestInfo.ip !== beforeIp) break
      if (latestInfo?.ip && !beforeIp) break
    }

    if (!latestInfo?.ip) {
      setPublicIpSummary('连接已开启，但暂时未检测到当前外网 IP')
      return
    }

    if (beforeIp && latestInfo.ip !== beforeIp) {
      setPublicIpSummary(`外网 IP 已从 ${beforeIp} 切换为 ${latestInfo.ip}`)
      return
    }

    if (beforeIp) {
      setPublicIpSummary(`外网 IP 未发生变化：${latestInfo.ip}`)
      return
    }

    setPublicIpSummary(`当前外网 IP：${latestInfo.ip}`)
  })

  const finishProtectionActivation = useCallback(
    async (mode: 'rule' | 'global', routeName?: string, beforeIp?: string) => {
      try {
        await reapplySavedSelections()
        await restorePreferredRoute(mode, routeName)
        await verifyPublicIpChange(beforeIp)
      } catch (error) {
        debugLog('[HomeRouteDebug] failed to finish protection activation', error)
      }
    },
    [reapplySavedSelections, restorePreferredRoute, verifyPublicIpChange],
  )

  useEffect(() => {
    if (isPreparingRoutes || publicIpInfo || isCheckingPublicIp || hasInitialIpCheck) return
    setHasInitialIpCheck(true)
    void refreshPublicIp(false)
  }, [
    hasInitialIpCheck,
    isCheckingPublicIp,
    isPreparingRoutes,
    publicIpInfo,
    refreshPublicIp,
  ])

  useEffect(() => {
    if (!routeDebugInfo) return

    const message = [
      `action=${routeDebugInfo.action}`,
      `target=${routeDebugInfo.targetRoute || '--'}`,
      `mode=${currentMode}`,
      `preferred=${preferredRouteName || '--'}`,
      `primary=${normalizeLabel(primaryGroup?.name) || '--'}:${normalizeLabel(primaryGroup?.now) || '--'}`,
      `global=${normalizeLabel(proxies?.global?.now) || '--'}`,
      `currentNode=${currentNode || '--'}`,
      `candidateGroups=${routeDebugInfo.candidateGroups.join(' > ') || '--'}`,
      `applied=${routeDebugInfo.appliedSelections.map((item) => `${item.name}:${item.now}`).join(' | ') || '--'}`,
      `saved=${routeDebugInfo.savedSelections.map((item) => `${item.name}:${item.now}`).join(' | ') || '--'}`,
    ].join(' ; ')

    debugLog('[HomeRouteDebug]', message)
    void logHomeRouteDebug(message).catch(() => {})
  }, [
    currentMode,
    currentNode,
    preferredRouteName,
    primaryGroup?.name,
    primaryGroup?.now,
    proxies?.global?.now,
    routeDebugInfo,
  ])

  const onChangeClashMode = useLockFn(async (mode: 'rule' | 'global') => {
    if (mode === currentMode || isPreparingRoutes) return
    const { targetRouteName } = resolvePreferredRoute()

    if (targetRouteName) {
      setPreferredRouteName(targetRouteName)
    }

    if (verge?.auto_close_connection) {
      closeAllConnections()
    }

    if (mode === 'global') {
      await syncRouteToGlobal(targetRouteName)
    }

    await patchClashMode(mode)
    await Promise.all([refreshClashConfig(), refreshProxy()])
    await reapplySavedSelections()
    await restorePreferredRoute(mode, targetRouteName)
  })

  const onToggleTunMode = useLockFn(async (nextValue?: boolean) => {
    if (isPreparingRoutes) return

    const target = typeof nextValue === 'boolean' ? nextValue : !Boolean(verge?.enable_tun_mode)
    const { targetRouteName } = resolvePreferredRoute()

    if (targetRouteName) {
      setPreferredRouteName(targetRouteName)
    }

    if (target && !isTunModeAvailable) {
      setIsInstallingTunService(true)
      try {
        showNotice.info('正在安装虚拟网卡服务，请稍候')
        await installService()

        const nextState = await mutateSystemState()
        const serviceReady =
          Boolean(nextState.data?.isServiceOk) || Boolean(nextState.data?.isAdminMode)

        if (!serviceReady) {
          throw new Error('虚拟网卡服务安装后仍不可用')
        }

        await patchVerge({ enable_tun_mode: true })
        await Promise.all([refreshClashConfig(), refreshProxy()])
        await reapplySavedSelections()
        await restorePreferredRoute(currentMode, targetRouteName)
        showNotice.success('虚拟网卡服务安装成功，已自动开启虚拟网卡模式')
      } catch (error) {
        showNotice.error('虚拟网卡服务安装失败，已保留当前代理规则', error)
      } finally {
        setIsInstallingTunService(false)
      }
      return
    }

    await patchVerge({ enable_tun_mode: target })
    await Promise.all([refreshClashConfig(), refreshProxy()])
    await reapplySavedSelections()
    await restorePreferredRoute(currentMode, targetRouteName)
  })

  const onSelectRoute = useLockFn(async (item: HomeRouteOption) => {
    if (isPreparingRoutes) return
    const beforeSwitchIp = publicIpInfo?.ip || ''

    const ready = await switchRoute(item)
    if (!ready) return

    setPreferredRouteName(item.name)

    if (currentMode === 'global') {
      await syncRouteToGlobal(item.name)
    }

     if (isProtected) {
      await verifyPublicIpChange(beforeSwitchIp)
    }
  })

  const onToggleProtection = useLockFn(async () => {
    if (isPreparingRoutes) return
    if (isTogglingProtection) return

    setIsTogglingProtection(true)
    try {

    if (verge?.enable_tun_mode) {
      await onToggleTunMode(false)
      return
    }

    if (systemProxyConfigState || systemProxyIndicator) {
      await toggleSystemProxy(false)
      setPublicIpSummary('连接已关闭，可重新检测当前外网 IP')
      return
    }

    const targetRoute = activeRoute || routeOptions[0]
    if (!targetRoute && routeOptions.length) return
    const beforeConnectIp =
      publicIpInfo?.ip || (await refreshPublicIp(false))?.ip || ''

    if (targetRoute?.name) {
      setPreferredRouteName(targetRoute.name)
      const activeNow = normalizeLabel(activeRouteName || currentNode)
      if (currentMode === 'global' || activeNow !== targetRoute.name) {
        await restorePreferredRoute(currentMode, targetRoute.name)
      }
    }

    await toggleSystemProxy(true)
    void finishProtectionActivation(currentMode, targetRoute?.name, beforeConnectIp)
    } finally {
      setIsTogglingProtection(false)
    }
  })

  const onRetestLatency = useLockFn(async () => {
    if (isLoadingRoutes || !routeOptions.length || isRetestingLatency) return

    setIsRetestingLatency(true)
    try {
      await checkYamlRoutePingDelays({
        timeout: Math.min(verge?.default_latency_timeout || 1500, 2500),
        rounds: 3,
      })
    } finally {
      setIsRetestingLatency(false)
    }
  })

  const onRefreshRoutes = useLockFn(async () => {
    if (isPreparingRoutes || isRefreshingRoutes) return

    setIsRefreshingRoutes(true)
    try {
      await refreshBluelayerSubscription()
      preparedLatencySessionKey = ''
      setIsRouteLatencyReady(false)
      showNotice.success('线路已重新获取')
    } catch (error) {
      showNotice.error('重新获取线路失败', error)
    } finally {
      setIsRefreshingRoutes(false)
    }
  })

  const surfaceStyle = {
    background: isLight ? 'rgba(255, 250, 242, 0.9)' : 'rgba(255,255,255,0.04)',
    border: isLight
      ? '1px solid rgba(31,24,16,0.08)'
      : '1px solid rgba(255,255,255,0.08)',
    boxShadow: isLight
      ? '0 24px 60px rgba(20,16,10,0.08)'
      : '0 24px 60px rgba(0,0,0,0.18)',
  } as const

  const ui = tinyHome
    ? {
        pagePadding: 0.9,
        pageGap: 0.75,
        cardPadding: 0.9,
        sectionGap: 0.75,
        titleSize: 14,
        bodySize: 11,
        metaSize: 10,
        routeItemPaddingX: 1,
        routeItemPaddingY: 0.78,
        chipHeight: 24,
      }
    : compactHome
      ? {
          pagePadding: 1.15,
          pageGap: 1,
          cardPadding: 1.05,
          sectionGap: 1,
          titleSize: 15,
          bodySize: 12,
          metaSize: 11,
          routeItemPaddingX: 1.1,
          routeItemPaddingY: 0.9,
          chipHeight: 26,
        }
      : {
          pagePadding: denseHome ? 1.5 : 2,
          pageGap: denseHome ? 1.25 : 1.5,
          cardPadding: 1.3,
          sectionGap: 1.2,
          titleSize: 16,
          bodySize: 13,
          metaSize: 11.5,
          routeItemPaddingX: 1.25,
          routeItemPaddingY: 1,
          chipHeight: 30,
        }

  if (isPreparingRoutes) {
    return (
      <BasePage
        title="控制中心"
        header={<Box />}
        full
        contentStyle={{
          height: '100%',
          minHeight: 0,
          display: 'flex',
          overflow: 'auto',
          overflowX: 'hidden',
        }}
      >
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <Box
            sx={{
              width: '100%',
              maxWidth: 460,
              borderRadius: 5,
              p: denseHome ? 3 : 4,
              textAlign: 'center',
              ...surfaceStyle,
            }}
          >
            <CircularProgress
              size={denseHome ? 34 : 40}
              sx={{ color: theme.palette.primary.main }}
            />
            <Typography sx={{ mt: 2, fontSize: denseHome ? 22 : 26, fontWeight: 900 }}>
              正在加载线路
            </Typography>
            <Typography sx={{ mt: 1, color: 'text.secondary', lineHeight: 1.7 }}>
              正在根据 YAML 中的线路地址完成 ping 测试，
              测试结束后才会开放线路选择和连接操作。
            </Typography>
          </Box>
        </Box>
      </BasePage>
    )
  }

  return (
    <BasePage
      title="控制中心"
      header={<Box />}
      full
      contentStyle={{
        height: '100%',
        minHeight: 0,
        display: 'flex',
        overflow: 'auto',
        overflowX: 'hidden',
      }}
    >
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          borderRadius: 5,
          p: ui.pagePadding,
          display: 'flex',
          flexDirection: 'column',
          gap: ui.pageGap,
          overflow: 'visible',
          position: 'relative',
          background: isLight
            ? 'linear-gradient(180deg, rgba(255,255,255,0.94), rgba(255,244,223,0.82))'
            : 'linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))',
          border: isLight
            ? '1px solid rgba(31,24,16,0.08)'
            : '1px solid rgba(255,255,255,0.08)',
          boxShadow: isLight
            ? '0 24px 60px rgba(20,16,10,0.08)'
            : '0 24px 60px rgba(0,0,0,0.18)',
        }}
      >
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            background: isLight
              ? 'radial-gradient(circle at 82% 18%, rgba(255,255,255,0.75), transparent 18%), radial-gradient(circle at 58% 78%, rgba(255,159,28,0.14), transparent 28%)'
              : 'radial-gradient(circle at 82% 18%, rgba(255,255,255,0.05), transparent 18%), radial-gradient(circle at 58% 78%, rgba(255,159,28,0.2), transparent 28%)',
          }}
        />

        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          flexWrap="wrap"
          sx={{
            position: 'relative',
            zIndex: 1,
            px: ui.cardPadding,
            py: tinyHome ? 0.6 : 0.75,
            borderRadius: 3.5,
            background: isLight
              ? 'linear-gradient(135deg, rgba(255,255,255,0.88), rgba(255,247,233,0.74))'
              : 'linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.03))',
            border: isLight
              ? '1px solid rgba(31,24,16,0.06)'
              : '1px solid rgba(255,255,255,0.08)',
            rowGap: tinyHome ? 0.5 : 0.8,
            '& .MuiChip-root': {
              height: ui.chipHeight,
              fontSize: tinyHome ? 11 : compactHome ? 12 : 12.5,
              borderRadius: 999,
              fontWeight: 800,
            },
          }}
        >
          <Chip
            icon={isProtected ? <ShieldRounded /> : <SecurityRounded />}
            label={isProtected ? 'VPN已连接' : 'VPN未连接'}
            sx={{
              borderRadius: 999,
              fontSize: ui.bodySize,
              backgroundColor: isProtected
                ? 'rgba(52,199,89,0.16)'
                : isLight
                  ? 'rgba(255, 244, 223, 0.92)'
                  : 'rgba(255,255,255,0.08)',
              color: isProtected
                ? isLight
                  ? '#19713a'
                  : '#7df2a1'
                : theme.palette.text.primary,
            }}
          />
          <Chip
            label={`剩余流量 ${formatTraffic(remainingTraffic)}`}
            size="small"
            sx={{
              borderRadius: 999,
              backgroundColor: alpha('#34c759', 0.12),
              color: isLight ? '#1f8d44' : '#7df2a1',
              fontWeight: 800,
            }}
          />
          <Chip
            label={`到期时间 ${packageExpireAt}`}
            size="small"
            sx={{
              borderRadius: 999,
              backgroundColor: isLight
                ? 'rgba(255,255,255,0.72)'
                : 'rgba(255,255,255,0.08)',
              color: theme.palette.text.primary,
              fontWeight: 800,
            }}
          />
        </Stack>

        <Box
          sx={{
            position: 'relative',
            zIndex: 1,
            display: 'grid',
            gridTemplateColumns: lowResHome
              ? '1fr'
              : { xs: '1fr', md: 'minmax(280px, 0.92fr) minmax(0, 1.08fr)' },
            gridTemplateRows: lowResHome ? 'auto minmax(300px, 1fr)' : undefined,
            alignItems: lowResHome ? 'start' : 'stretch',
            gap: ui.pageGap,
            minHeight: 0,
            flex: 1,
          }}
        >
          <Box
            sx={{
              minHeight: lowResHome ? 'auto' : 0,
              borderRadius: 4,
              p: ui.cardPadding,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: lowResHome ? 'flex-start' : 'center',
              textAlign: 'center',
              gap: ui.sectionGap,
              background: isLight
                ? 'linear-gradient(180deg, rgba(255,255,255,0.88), rgba(255,249,239,0.78))'
                : 'linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.03))',
              border: isLight
                ? '1px solid rgba(31,24,16,0.08)'
                : '1px solid rgba(255,255,255,0.08)',
            }}
          >
            <Box
              sx={{
                width: '100%',
                borderRadius: 3.5,
                px: ui.cardPadding,
                py: tinyHome ? 0.5 : compactHome ? 0.6 : 0.72,
                mb: 0,
                mt: lowResHome ? 0 : compactHome ? -0.45 : -0.3,
                textAlign: 'left',
                background: isLight
                  ? 'linear-gradient(135deg, rgba(255,255,255,0.54), rgba(255,247,233,0.42))'
                  : 'linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,159,28,0.05))',
                border: isLight
                  ? '1px solid rgba(31,24,16,0.05)'
                  : '1px solid rgba(255,255,255,0.05)',
                backdropFilter: 'blur(8px)',
              }}
            >
              <Stack
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                spacing={0.8}
                sx={{ px: compactHome ? 0.15 : 0.2 }}
              >
                <Typography
                  sx={{
                    fontSize: ui.metaSize,
                    color: 'text.secondary',
                    fontWeight: 700,
                    letterSpacing: 0.2,
                  }}
                >
                  当前外网 IP
                </Typography>
                <IconButton
                  size="small"
                  onClick={() => void refreshPublicIp()}
                  sx={{ color: 'text.secondary', p: 0.3, mr: -0.15 }}
                >
                  {isCheckingPublicIp ? (
                    <CircularProgress size={14} sx={{ color: 'inherit' }} />
                  ) : (
                    <RefreshRounded sx={{ fontSize: 16 }} />
                  )}
                </IconButton>
              </Stack>
              <Typography
                sx={{
                  mt: 0.1,
                  fontSize: tinyHome ? 13 : compactHome ? 14 : 16,
                  fontWeight: 900,
                  lineHeight: 1.15,
                  wordBreak: 'break-all',
                }}
              >
                {isCheckingPublicIp && !publicIpInfo?.ip
                  ? '检测中...'
                  : publicIpInfo?.ip || '--'}
              </Typography>
              <Typography
                sx={{
                  mt: 0.1,
                  fontSize: ui.metaSize,
                  color: 'text.secondary',
                  lineHeight: 1.4,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {[publicIpInfo?.country, publicIpInfo?.region, publicIpInfo?.city]
                  .filter(Boolean)
                  .join(' / ') || publicIpInfo?.organization || publicIpSummary}
              </Typography>
            </Box>

            <Tooltip
              title={
                verge?.enable_tun_mode
                  ? '打开设置'
                  : isProtected
                    ? '断开代理'
                    : '使用当前线路连接'
              }
              arrow
            >
              <IconButton
                onClick={() => void onToggleProtection()}
                disabled={isTogglingProtection}
                sx={{
                  width: tinyHome ? 68 : compactHome ? 80 : denseHome ? 90 : 104,
                  height: tinyHome ? 68 : compactHome ? 80 : denseHome ? 90 : 104,
                  border: isLight
                    ? '1px solid rgba(255,159,28,0.18)'
                    : '1px solid rgba(255,255,255,0.12)',
                  background: isProtected
                    ? 'linear-gradient(135deg, rgba(52,199,89,0.28), rgba(255,159,28,0.22))'
                    : isLight
                      ? 'rgba(255,255,255,0.82)'
                      : 'rgba(255,255,255,0.08)',
                  boxShadow: isProtected
                    ? '0 24px 48px rgba(52,199,89,0.18)'
                    : isLight
                      ? '0 18px 36px rgba(20,16,10,0.12)'
                      : '0 18px 36px rgba(0,0,0,0.18)',
                  color: isProtected
                    ? isLight
                      ? '#19713a'
                      : '#7df2a1'
                    : theme.palette.text.primary,
                }}
              >
                {isTogglingProtection ? (
                  <CircularProgress
                    size={tinyHome ? 24 : compactHome ? 32 : denseHome ? 36 : 40}
                    sx={{
                      color: isProtected
                        ? isLight
                          ? '#19713a'
                          : '#7df2a1'
                        : theme.palette.text.primary,
                    }}
                  />
                ) : (
                  <PowerSettingsNewRounded
                    sx={{ fontSize: tinyHome ? 32 : compactHome ? 42 : denseHome ? 48 : 54 }}
                  />
                )}
              </IconButton>
            </Tooltip>

            <Stack
              direction="row"
              spacing={tinyHome ? 0.7 : 1}
              useFlexGap
              flexWrap="wrap"
              sx={{
                mt: 0,
                justifyContent: 'center',
              }}
            >
              {[
                { key: 'rule' as const, label: '规则模式' },
                { key: 'global' as const, label: '全局模式' },
                { key: 'tun' as const, label: '虚拟网卡' },
              ].map((mode) => {
                const label =
                  mode.key === 'tun' && isInstallingTunService ? '安装中' : mode.label
                const selected =
                  mode.key === 'tun'
                    ? Boolean(verge?.enable_tun_mode)
                    : currentMode === mode.key
                const disabled =
                  mode.key === 'tun' ? isInstallingTunService : false
                return (
                  <Box
                    key={mode.key}
                    onClick={() => {
                      if (disabled) return
                      if (mode.key === 'tun') {
                        void onToggleTunMode()
                        return
                      }
                      void onChangeClashMode(mode.key)
                    }}
                    sx={{
                      px: tinyHome ? 1.05 : compactHome ? 1.3 : 1.6,
                      py: tinyHome ? 0.6 : 0.75,
                      borderRadius: 999,
                      cursor: disabled ? 'not-allowed' : 'pointer',
                      opacity: disabled ? 0.5 : 1,
                      fontSize: tinyHome ? 11 : compactHome ? 12 : 13,
                      fontWeight: 800,
                      color: selected
                        ? mode.key === 'tun'
                          ? isLight
                            ? '#134a28'
                            : '#0f2217'
                          : isLight
                            ? '#1d1204'
                            : '#0f0f12'
                        : theme.palette.text.secondary,
                      background: selected
                        ? mode.key === 'tun'
                          ? 'linear-gradient(135deg, #8ee59e, #34c759)'
                          : 'linear-gradient(135deg, #ffb64d, #ff9f1c)'
                        : isLight
                          ? 'rgba(255,255,255,0.72)'
                          : 'rgba(255,255,255,0.08)',
                      border: selected
                        ? mode.key === 'tun'
                          ? '1px solid rgba(52,199,89,0.18)'
                          : '1px solid rgba(255,159,28,0.16)'
                        : isLight
                          ? '1px solid rgba(31,24,16,0.08)'
                          : '1px solid rgba(255,255,255,0.08)',
                      boxShadow: selected
                        ? mode.key === 'tun'
                          ? '0 12px 24px rgba(52,199,89,0.18)'
                          : '0 12px 24px rgba(255,159,28,0.2)'
                        : 'none',
                      transition: 'all 0.18s ease',
                      userSelect: 'none',
                    }}
                  >
                    {label}
                  </Box>
                )
              })}
            </Stack>

            <Typography
              sx={{
                mt: 0,
                color: 'text.secondary',
                fontSize: ui.bodySize,
              }}
            >
              当前线路
            </Typography>
            <Typography
              sx={{
                mt: 0.35,
                fontSize: tinyHome ? 16 : compactHome ? 18 : denseHome ? 20 : 24,
                lineHeight: 1.18,
                fontWeight: 900,
                display: '-webkit-box',
                WebkitLineClamp: tinyHome ? 2 : 3,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                wordBreak: 'break-word',
              }}
            >
              {activeRoute?.name || activeRouteName || currentNode}
            </Typography>
            <Typography
              sx={{
                mt: 0.15,
                color: 'text.secondary',
                fontSize: ui.bodySize,
                lineHeight: 1.55,
                display: '-webkit-box',
                WebkitLineClamp: tinyHome ? 2 : 3,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {verge?.enable_tun_mode
                ? '当前已启用 TUN 模式，请前往设置页管理高级流量转发。'
                : isProtected
                  ? `系统代理已开启${systemProxyAddress ? `，${systemProxyAddress}` : ''}`
                  : '点击电源开关即可连接。'}
            </Typography>
            <Stack
              direction={tinyHome ? 'column' : 'row'}
              spacing={tinyHome ? 0.7 : 1}
              sx={{ mt: 0, width: '100%', justifyContent: 'center' }}
            >
              {[
                { label: '上行速率', value: uploadSpeed },
                { label: '下行速率', value: downloadSpeed },
              ].map((item) => (
                <Box
                  key={item.label}
                  sx={{
                    minWidth: 0,
                    flex: 1,
                    maxWidth: 160,
                    borderRadius: 2.5,
                    px: tinyHome ? 0.95 : compactHome ? 1 : 1.1,
                    py: tinyHome ? 0.7 : 0.85,
                    textAlign: 'center',
                    background: isLight
                      ? 'rgba(255,255,255,0.9)'
                      : 'rgba(255,255,255,0.06)',
                    border: isLight
                      ? '1px solid rgba(31,24,16,0.08)'
                      : '1px solid rgba(255,255,255,0.08)',
                  }}
                >
                  <Typography
                    sx={{
                      fontSize: ui.metaSize,
                      color: 'text.secondary',
                      fontWeight: 700,
                    }}
                  >
                    {item.label}
                  </Typography>
                  <Typography
                    sx={{
                      mt: 0.25,
                      fontSize: ui.bodySize,
                      fontWeight: 900,
                      lineHeight: 1.2,
                    }}
                  >
                    {formatTrafficSpeed(item.value)}
                  </Typography>
                </Box>
              ))}
            </Stack>
          </Box>

          <Box
            sx={{
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              borderRadius: 4,
              p: ui.cardPadding,
              background: isLight
                ? 'linear-gradient(180deg, rgba(255,255,255,0.88), rgba(255,249,239,0.76))'
                : 'linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.03))',
              border: isLight
                ? '1px solid rgba(31,24,16,0.08)'
                : '1px solid rgba(255,255,255,0.08)',
            }}
          >
            <Stack
              direction={lowResHome ? 'column' : 'row'}
              alignItems={lowResHome ? 'flex-start' : 'center'}
              justifyContent="space-between"
              spacing={lowResHome ? 0.4 : 0}
              sx={{ mb: ui.sectionGap }}
            >
              <Typography sx={{ fontSize: ui.titleSize, fontWeight: 900 }}>
                线路选择
              </Typography>
              <Typography sx={{ color: 'text.secondary', fontSize: ui.metaSize }}>
                共 {routeOptions.length} 条
              </Typography>
            </Stack>

            <Stack
              direction="row"
              spacing={tinyHome ? 0.7 : 1}
              useFlexGap
              flexWrap="wrap"
              sx={{
                justifyContent: lowResHome ? 'flex-start' : 'flex-end',
                mb: ui.sectionGap,
              }}
            >
              <Chip
                icon={
                  isRefreshingRoutes ? (
                    <CircularProgress size={14} sx={{ color: 'inherit !important' }} />
                  ) : (
                    <RefreshRounded />
                  )
                }
                label={isRefreshingRoutes ? '获取中' : '重新获取线路'}
                size="small"
                onClick={() => void onRefreshRoutes()}
                sx={{
                  height: ui.chipHeight + 2,
                  borderRadius: 999,
                  fontWeight: 800,
                  cursor: isRefreshingRoutes ? 'default' : 'pointer',
                  backgroundColor: isLight
                    ? 'rgba(255,255,255,0.92)'
                    : 'rgba(255,255,255,0.08)',
                  color: theme.palette.text.primary,
                  border: isLight
                    ? '1px solid rgba(31,24,16,0.08)'
                    : '1px solid rgba(255,255,255,0.08)',
                  '& .MuiChip-icon': {
                    color: 'inherit',
                  },
                }}
              />
              <Chip
                icon={
                  isRetestingLatency ? (
                    <CircularProgress size={14} sx={{ color: 'inherit !important' }} />
                  ) : (
                    <RefreshRounded />
                  )
                }
                label={isRetestingLatency ? '测速中' : '手动测速'}
                size="small"
                onClick={() => void onRetestLatency()}
                sx={{
                  height: ui.chipHeight + 2,
                  borderRadius: 999,
                  fontWeight: 800,
                  cursor: isRetestingLatency ? 'default' : 'pointer',
                  backgroundColor: isLight
                    ? 'rgba(255,255,255,0.92)'
                    : 'rgba(255,255,255,0.08)',
                  color: theme.palette.text.primary,
                  border: isLight
                    ? '1px solid rgba(31,24,16,0.08)'
                    : '1px solid rgba(255,255,255,0.08)',
                  '& .MuiChip-icon': {
                    color: 'inherit',
                  },
                }}
              />
            </Stack>

            <Box
              sx={{
                flex: 1,
                height: 0,
                minHeight: 0,
                overflowY: 'auto',
                pr: 0.5,
                mr: -0.5,
                '&::-webkit-scrollbar': {
                  width: 8,
                },
                '&::-webkit-scrollbar-thumb': {
                  borderRadius: 999,
                  backgroundColor: isLight
                    ? 'rgba(31,24,16,0.18)'
                    : 'rgba(255,255,255,0.18)',
                },
                '&::-webkit-scrollbar-track': {
                  backgroundColor: 'transparent',
                },
              }}
            >
              <Stack spacing={0.85}>
                {routeOptions.map((item) => {
                  const selected = item.name === (activeRoute?.name || activeRouteName)
                  const countryCode = getRouteCountryCode(item.name)
                  const delayTone = getDelayTone(item.delay)
                  const delayLabel = formatDelayLabel(item.delay)

                  return (
                    <Box
                      key={item.name}
                      onClick={() => void onSelectRoute(item)}
                      sx={{
                        borderRadius: 3,
                        px: ui.routeItemPaddingX,
                        py: ui.routeItemPaddingY,
                        display: 'flex',
                        alignItems: 'center',
                        gap: tinyHome ? 0.8 : 1,
                        cursor: 'pointer',
                        transition: 'all 0.18s ease',
                        background: selected
                          ? isLight
                            ? 'linear-gradient(135deg, rgba(255,236,199,0.96), rgba(255,244,223,0.92))'
                            : 'linear-gradient(135deg, rgba(255,159,28,0.18), rgba(255,255,255,0.08))'
                          : isLight
                            ? 'rgba(255,255,255,0.86)'
                            : 'rgba(255,255,255,0.05)',
                        border: selected
                          ? '1px solid rgba(255,159,28,0.38)'
                          : isLight
                            ? '1px solid rgba(31,24,16,0.08)'
                            : '1px solid rgba(255,255,255,0.06)',
                        boxShadow: selected
                          ? '0 14px 28px rgba(255,159,28,0.12)'
                          : 'none',
                      }}
                    >
                      <RouteFlag
                        countryCode={countryCode}
                        compact={compactHome}
                        isLight={isLight}
                      />

                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography
                          sx={{
                            fontSize: ui.bodySize,
                            fontWeight: selected ? 900 : 800,
                            lineHeight: 1.25,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {item.name}
                        </Typography>
                      </Box>

                      <Chip
                        label={delayLabel}
                        size="small"
                        sx={{
                          flexShrink: 0,
                          borderRadius: 999,
                          fontWeight: 800,
                          color:
                            delayTone === 'good'
                              ? isLight
                                ? '#1f8d44'
                                : '#7df2a1'
                              : delayTone === 'medium'
                                ? '#7f5600'
                                : theme.palette.text.secondary,
                          backgroundColor:
                            delayTone === 'good'
                              ? alpha('#34c759', 0.14)
                              : delayTone === 'medium'
                                ? alpha('#ff9f1c', 0.16)
                                : isLight
                                  ? 'rgba(31,24,16,0.06)'
                                  : 'rgba(255,255,255,0.08)',
                        }}
                      />
                    </Box>
                  )
                })}
              </Stack>
            </Box>
          </Box>
        </Box>
      </Box>
    </BasePage>
  )
}

export default HomePage
