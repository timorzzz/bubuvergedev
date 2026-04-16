import {
  ArrowDropDownRounded,
  BoltRounded,
  HelpOutlineRounded,
  PowerSettingsNewRounded,
  RefreshRounded,
} from '@mui/icons-material'
import {
  alpha,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { useLockFn } from 'ahooks'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { closeAllConnections } from 'tauri-plugin-mihomo-api'

import { BasePage } from '@/components/base'
import { HomeRouteOption, useHomeRoutes } from '@/hooks/use-home-routes'
import { useProfiles } from '@/hooks/use-profiles'
import { useSystemProxyState } from '@/hooks/use-system-proxy-state'
import { useSystemState } from '@/hooks/use-system-state'
import { useTrafficData } from '@/hooks/use-traffic-data'
import { useVerge } from '@/hooks/use-verge'
import { useAppData } from '@/providers/app-data-context'
import { getIpInfo } from '@/services/api'
import {
  openInvitePage,
  openRechargePage,
  openPurchasePage,
  openSupportPage,
  refreshBluelayerSubscription,
  useBluelayerState,
} from '@/services/bluelayer'
import {
  getProfiles,
  installService,
  patchClashMode,
  setTunModeEnabled,
} from '@/services/cmds'
import { showNotice } from '@/services/notice-service'

let preparedLatencySessionKey = ''
type PublicIpSnapshot = Awaited<ReturnType<typeof getIpInfo>>

const normalizeLabel = (value: unknown) => {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number') return String(value)
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

const formatTrafficCompact = (value?: number) => formatTraffic(value).replace(' ', '')

const formatTrafficSpeed = (value?: number) => `${formatTraffic(value)}/s`

const formatCurrency = (value?: string | number | null) => {
  const normalized =
    typeof value === 'number' ? value : Number(value == null || value === '' ? 0 : value)
  return `￥${Number.isFinite(normalized) ? normalized.toFixed(2) : '0.00'}`
}

const formatDelayLabel = (delay: number) => {
  if (delay === -2) return '测速中'
  if (delay > 0 && delay < 1e5) return `${Math.round(delay)} ms`
  if (delay === 0 || delay >= 1e5) return '超时'
  return '--'
}

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

const GAUGE_START_ANGLE = -120
const GAUGE_END_ANGLE = 120

const polarToCartesian = (
  centerX: number,
  centerY: number,
  radius: number,
  angleInDegrees: number,
) => {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0

  return {
    x: centerX + radius * Math.cos(angleInRadians),
    y: centerY + radius * Math.sin(angleInRadians),
  }
}

const describeArc = (
  centerX: number,
  centerY: number,
  radius: number,
  startAngle: number,
  endAngle: number,
) => {
  const start = polarToCartesian(centerX, centerY, radius, endAngle)
  const end = polarToCartesian(centerX, centerY, radius, startAngle)
  const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1'

  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`
}

const gaugeTicks = Array.from({ length: 21 }, (_, index) => {
  const angle =
    GAUGE_START_ANGLE +
    ((GAUGE_END_ANGLE - GAUGE_START_ANGLE) / 20) * index
  const major = index % 5 === 0
  return {
    angle,
    major,
  }
})

const RouteFlag = ({ countryCode, size = 28 }: { countryCode: string; size?: number }) => {
  const [failed, setFailed] = useState(false)
  const normalizedCode = /^[A-Z]{2}$/.test(countryCode) ? countryCode : ''

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
          background: '#f4f6fb',
          color: '#6d7786',
          fontSize: 11,
          fontWeight: 700,
          flexShrink: 0,
          overflow: 'hidden',
        }}
      >
        {normalizedCode || '节点'}
      </Box>
    )
  }

  return (
    <Box
      component="img"
      src={getCountryFlagUrl(normalizedCode)}
      alt={normalizedCode}
      onError={() => setFailed(true)}
        sx={{
        width: size,
        height: size,
        borderRadius: '50%',
        objectFit: 'cover',
        flexShrink: 0,
        overflow: 'hidden',
      }}
    />
  )
}

const HomePage = () => {
  const theme = useTheme()
  const { activateSelected } = useProfiles()
  const { verge, mutateVerge } = useVerge()
  const { isTunModeAvailable, mutateSystemState } = useSystemState()
  const { session } = useBluelayerState()
  const { clashConfig, proxies, refreshClashConfig, refreshProxy } = useAppData()
  const {
    checkYamlRoutePingDelays,
    currentNode: routeCurrentNode,
    currentProfileUid,
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
  const [routePanelOpen, setRoutePanelOpen] = useState(false)
  const routePanelRef = useRef<HTMLDivElement | null>(null)
  const [publicIpInfo, setPublicIpInfo] = useState<PublicIpSnapshot | null>(null)
  const [isCheckingPublicIp, setIsCheckingPublicIp] = useState(false)
  const [publicIpSummary, setPublicIpSummary] = useState('连接后将自动检测外网 IP 是否变更')
  const [hasInitialIpCheck, setHasInitialIpCheck] = useState(false)

  const user = session?.userInfo
  const totalTraffic = Math.max(user?.traffic?.total || 0, 0)
  const remainingTraffic = Math.max(
    totalTraffic - (user?.traffic?.used || 0),
    0,
  )
  const remainingTrafficRatio =
    totalTraffic > 0
      ? Math.min(Math.max(remainingTraffic / totalTraffic, 0), 1)
      : 0
  const remainingTrafficPercent = Math.round(remainingTrafficRatio * 100)
  const remainingTrafficDisplay = session?.userInfo
    ? formatTrafficCompact(remainingTraffic)
    : '--'
  const gaugeProgressAngle =
    GAUGE_START_ANGLE +
    (GAUGE_END_ANGLE - GAUGE_START_ANGLE) * remainingTrafficRatio
  const packageLevel = user?.class ? `VIP${user.class}会员` : '未开通套餐'
  const packageExpireAt = user?.class_expire || '未设置'

  useEffect(() => {
    if (!routePanelOpen) return

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (routePanelRef.current?.contains(target)) return
      setRoutePanelOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('touchstart', handlePointerDown)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('touchstart', handlePointerDown)
    }
  }, [routePanelOpen])

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
  const modeResolvedRouteName = normalizeLabel(
    activeRouteName || currentNode || routeOptions[0]?.name,
  )

  const activeRoute = useMemo(
    () => {
      if (currentMode === 'global' && modeResolvedRouteName) {
        return (
          routeOptions.find((item) => item.name === modeResolvedRouteName) ||
          routeOptions.find((item) => item.name === preferredRouteName) ||
          routeOptions[0]
        )
      }

      return (
        routeOptions.find((item) => item.name === preferredRouteName) ||
        routeOptions.find((item) => item.name === activeRouteName) ||
        routeOptions.find((item) => item.name === currentNode) ||
        routeOptions[0]
      )
    },
    [
      activeRouteName,
      currentMode,
      currentNode,
      modeResolvedRouteName,
      preferredRouteName,
      routeOptions,
    ],
  )
  const activeRouteDelay = activeRoute?.delay ?? -1

  useEffect(() => {
    if (!routeOptions.length) {
      setPreferredRouteName('')
      return
    }

    if (currentMode === 'global') {
      if (modeResolvedRouteName && modeResolvedRouteName !== preferredRouteName) {
        setPreferredRouteName(modeResolvedRouteName)
      }
      return
    }

    if (
      preferredRouteName &&
      routeOptions.some((item) => item.name === preferredRouteName)
    ) {
      return
    }

    const fallbackRouteName = modeResolvedRouteName

    if (fallbackRouteName && fallbackRouteName !== preferredRouteName) {
      setPreferredRouteName(fallbackRouteName)
    }
  }, [
    activeRouteName,
    currentMode,
    currentNode,
    modeResolvedRouteName,
    preferredRouteName,
    routeOptions,
  ])

  const isProtectionEnabled =
    Boolean(verge?.enable_tun_mode) || Boolean(verge?.enable_system_proxy)
  const hasActiveTraffic =
    isProtectionEnabled || systemProxyIndicator || systemProxyConfigState
  const { response: trafficResponse } = useTrafficData({ enabled: hasActiveTraffic })
  const isPreparingRoutes =
    isLoadingRoutes || (routeOptions.length > 0 && !isRouteLatencyReady)
  const uploadSpeed = trafficResponse.data?.up ?? 0
  const downloadSpeed = trafficResponse.data?.down ?? 0

  const resolvePreferredRoute = useCallback(
    (explicitRouteName?: string) => {
      const targetRouteName = normalizeLabel(
        explicitRouteName ||
          (currentMode === 'global'
            ? activeRouteName || currentNode || preferredRouteName
            : preferredRouteName || activeRouteName || currentNode) ||
          routeOptions[0]?.name,
      )

      return {
        targetRouteName,
        targetRoute:
          routeOptions.find((item) => item.name === targetRouteName) ||
          routeOptions[0],
      }
    },
    [activeRouteName, currentMode, currentNode, preferredRouteName, routeOptions],
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
      } catch {
        continue
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
      void (async () => {
        await reapplySavedSelections()
        await restorePreferredRoute(mode, routeName)
        await verifyPublicIpChange(beforeIp)
      })()
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

        await setTunModeEnabled(true)
        mutateVerge()
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

    await setTunModeEnabled(target)
    mutateVerge()
    await Promise.all([refreshClashConfig(), refreshProxy()])
    await reapplySavedSelections()
    await restorePreferredRoute(currentMode, targetRouteName)
  })

  const onSelectRoute = useLockFn(async (item: HomeRouteOption) => {
    if (isPreparingRoutes) return
    const beforeSwitchIp = publicIpInfo?.ip || ''

    const ready =
      currentMode === 'global'
        ? await syncRouteToGlobal(item.name)
        : await switchRoute(item)
    if (!ready) return

    setPreferredRouteName(item.name)
    setRoutePanelOpen(false)

    if (hasActiveTraffic) {
      await verifyPublicIpChange(beforeSwitchIp)
    }
  })

  const onToggleProtection = useLockFn(async () => {
    if (isPreparingRoutes || isTogglingProtection) return

    setIsTogglingProtection(true)
    try {
      if (verge?.enable_tun_mode) {
        await onToggleTunMode(false)
        return
      }

      if (Boolean(verge?.enable_system_proxy) || systemProxyIndicator) {
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
        if (activeNow !== targetRoute.name) {
          await onSelectRoute(targetRoute)
        }
      }

      await toggleSystemProxy(true)
      finishProtectionActivation(currentMode, targetRoute?.name, beforeConnectIp)
    } finally {
      setIsTogglingProtection(false)
    }
  })

  const onRetestLatency = useLockFn(async () => {
    if (!routeOptions.length) return
    setIsRetestingLatency(true)
    try {
      await checkYamlRoutePingDelays({
        timeout: Math.min(verge?.default_latency_timeout || 1500, 2500),
        rounds: 3,
      })
      await refreshProxy()
      showNotice.success('线路测速已刷新')
    } catch (error) {
      showNotice.error('线路测速失败', error)
    } finally {
      setIsRetestingLatency(false)
    }
  })

  const onRefreshRoutes = useLockFn(async () => {
    setIsRefreshingRoutes(true)
    try {
      await refreshBluelayerSubscription()
      preparedLatencySessionKey = ''
      setIsRouteLatencyReady(false)
      await Promise.all([refreshClashConfig(), refreshProxy()])
      await checkYamlRoutePingDelays({
        timeout: Math.min(verge?.default_latency_timeout || 1500, 2500),
        rounds: 3,
      })
      setPublicIpSummary('线路已更新，请重新选择并连接')
      showNotice.success('线路获取成功')
    } catch (error) {
      showNotice.error('重新获取线路失败', error)
    } finally {
      setIsRefreshingRoutes(false)
    }
  })

  if (isPreparingRoutes) {
    return (
      <BasePage title="加速" header={<Box />} full contentStyle={{ height: '100%' }}>
        <Box
          sx={{
            height: '100%',
            display: 'grid',
            placeItems: 'center',
            background: '#ffffff',
            border: '1px solid rgba(19, 31, 53, 0.08)',
          }}
        >
          <Box sx={{ textAlign: 'center' }}>
            <CircularProgress size={32} />
            <Typography sx={{ mt: 2, fontSize: 18, fontWeight: 700 }}>正在加载线路</Typography>
            <Typography sx={{ mt: 1, color: 'text.secondary', lineHeight: 1.7 }}>
              正在测试线路延迟中...
            </Typography>
          </Box>
        </Box>
      </BasePage>
    )
  }

  return (
    <BasePage
      title="加速"
      header={
        <Stack direction="row" spacing={1.2} alignItems="center">
          <Typography sx={{ fontSize: 14, color: '#de5548', fontWeight: 700 }}>
            ↑ {formatTrafficSpeed(uploadSpeed)}
          </Typography>
          <Typography sx={{ fontSize: 14, color: '#2d9b46', fontWeight: 700 }}>
            ↓ {formatTrafficSpeed(downloadSpeed)}
          </Typography>
        </Stack>
      }
      full
      contentStyle={{ height: '100%', minHeight: 0, display: 'flex' }}
    >
      <Box sx={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '1fr 170px', gap: 1.2 }}>
        <Box sx={{ background: '#f3f6fb', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <Box sx={{ flex: 1, m: 1.2, background: '#ffffff', display: 'grid', gridTemplateRows: 'auto auto auto 1fr auto auto', px: 2.8, py: 2.1, position: 'relative', overflow: 'hidden' }}>
            <Box
              sx={{
                alignSelf: 'center',
                mb: 1.4,
                px: 0,
                py: 0,
                minWidth: 270,
              }}
            >
              <Stack direction="row" spacing={0.8} alignItems="center" justifyContent="center">
                <RouteFlag countryCode={publicIpInfo?.country_code || ''} size={20} />
                <Typography sx={{ fontSize: 14, fontWeight: 700, color: '#263247', lineHeight: 1 }}>
                  {isCheckingPublicIp && !publicIpInfo?.ip ? '\u68c0\u6d4b\u4e2d...' : publicIpInfo?.ip || '--'}
                </Typography>
                <IconButton size="small" onClick={() => void refreshPublicIp()} sx={{ p: 0.15, ml: 0.35 }}>
                  {isCheckingPublicIp ? <CircularProgress size={12} /> : <RefreshRounded sx={{ fontSize: 14 }} />}
                </IconButton>
              </Stack>
            </Box>

            <Box sx={{ justifySelf: 'center', display: 'inline-flex', alignItems: 'center', gap: 0.8, pb: 2.1, borderBottom: '1px dashed rgba(19, 31, 53, 0.12)' }}>
              {[{ key: 'rule' as const, label: '\u667a\u80fd\u4ee3\u7406' }, { key: 'global' as const, label: '\u5168\u5c40\u4ee3\u7406' }].map((mode) => (
                <Box key={mode.key} onClick={() => void onChangeClashMode(mode.key)} sx={{ minWidth: 86, px: 1.8, py: 0.75, textAlign: 'center', fontSize: 14, fontWeight: 700, cursor: 'pointer', border: '1px solid rgba(19, 31, 53, 0.16)', background: currentMode === mode.key ? '#2688ea' : '#ffffff', color: currentMode === mode.key ? '#ffffff' : '#394559' }}>
                  {mode.label}
                </Box>
              ))}
              <Box
                onClick={() => void onToggleTunMode()}
                sx={{
                  minWidth: 86,
                  px: 1.8,
                  py: 0.75,
                  textAlign: 'center',
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: 'pointer',
                  border: '1px solid rgba(19, 31, 53, 0.16)',
                  background: verge?.enable_tun_mode ? '#2688ea' : '#ffffff',
                  color: verge?.enable_tun_mode ? '#ffffff' : '#394559',
                }}
              >
                {'\u865a\u62df\u7f51\u5361'}
              </Box>
              <Tooltip
                title={
                  <Box sx={{ maxWidth: 320, whiteSpace: 'pre-line', lineHeight: 1.7 }}>
                    {'智能代理：自动选择更合适的代理方式或节点，尽量兼顾速度、稳定性和易用性。\n\n全局代理：所有网络流量都强制通过代理，适合需要全部流量都翻墙的场景。\n\n虚拟网卡模式：通过创建虚拟网卡接管系统流量，兼容性更强，适合系统代理无效时使用。'}
                  </Box>
                }
              >
                <Box sx={{ width: 24, height: 24, borderRadius: '50%', display: 'grid', placeItems: 'center', color: '#8a94a6', cursor: 'help' }}>
                  <HelpOutlineRounded sx={{ fontSize: 18 }} />
                </Box>
              </Tooltip>
            </Box>

            <Box ref={routePanelRef} sx={{ mt: 2.2, position: 'relative' }}>
              <Stack direction="row" spacing={1.2} alignItems="center">
                <Tooltip title="点击可以同步最新线路">
                  <IconButton onClick={() => void onRefreshRoutes()} size="small" sx={{ width: 34, height: 34, border: '1px solid rgba(19, 31, 53, 0.14)', background: '#ffffff' }}>
                    {isRefreshingRoutes ? <CircularProgress size={16} /> : <RefreshRounded sx={{ fontSize: 18 }} />}
                  </IconButton>
                </Tooltip>
                <Box onClick={() => setRoutePanelOpen((value) => !value)} sx={{ flex: 1, height: 34, px: 1.2, display: 'flex', alignItems: 'center', gap: 1, border: '1px solid #5da1ec', background: '#ffffff', cursor: 'pointer' }}>
                  {activeRoute?.name ? <RouteFlag countryCode={getRouteCountryCode(activeRoute.name)} size={22} /> : null}
                  <Typography sx={{ flex: 1, minWidth: 0, fontSize: 14, color: activeRoute?.name ? '#314057' : '#a1aabc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {activeRoute?.name || '选择你要使用的线路'}
                  </Typography>
                  {activeRoute?.name ? (
                    <Typography sx={{ fontSize: 13, color: '#2d9b46', fontWeight: 700, flexShrink: 0 }}>
                      {formatDelayLabel(activeRouteDelay)}
                    </Typography>
                  ) : null}
                  <ArrowDropDownRounded sx={{ color: '#9aa5b8', ml: activeRoute?.name ? 0 : 'auto' }} />
                </Box>
                <Tooltip title="测试线路的连通性，请在“断开连接”状态下在进行测试">
                  <IconButton onClick={() => void onRetestLatency()} size="small" sx={{ width: 34, height: 34, border: '1px solid rgba(19, 31, 53, 0.14)', background: '#ffffff' }}>
                    {isRetestingLatency ? <CircularProgress size={16} /> : <BoltRounded sx={{ fontSize: 18 }} />}
                  </IconButton>
                </Tooltip>
              </Stack>

              {routePanelOpen && (
                <Box sx={{ position: 'absolute', left: 46, right: 46, top: 40, zIndex: 2, maxHeight: 240, overflowY: 'auto', background: '#ffffff', border: '1px solid rgba(19, 31, 53, 0.12)', boxShadow: '0 14px 30px rgba(17, 24, 38, 0.10)' }}>
                  {routeOptions.length ? (
                    <Stack spacing={0}>
                      {routeOptions.map((item) => {
                        const selected = item.name === (activeRoute?.name || activeRouteName)
                        return (
                          <Box key={item.name} onClick={() => void onSelectRoute(item)} sx={{ px: 1.5, py: 1, display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer', background: selected ? '#f5f9ff' : '#ffffff', borderBottom: '1px solid rgba(19, 31, 53, 0.06)', '&:hover': { background: '#f5f9ff' } }}>
                            <RouteFlag countryCode={getRouteCountryCode(item.name)} />
                            <Typography sx={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: selected ? 700 : 500, color: '#263247', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {item.name}
                            </Typography>
                            <Typography sx={{ fontSize: 13, color: '#2d9b46', fontWeight: 700 }}>
                              {formatDelayLabel(item.delay)}
                            </Typography>
                          </Box>
                        )
                      })}
                    </Stack>
                  ) : (
                    <Box sx={{ py: 4, textAlign: 'center', color: '#b4bcc9', fontSize: 14 }}>No Data</Box>
                  )}
                </Box>
              )}
            </Box>

            <Box
              sx={{
                position: 'relative',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'flex-start',
                minHeight: 204,
                mt: 0.7,
              }}
            >
              <Box sx={{ position: 'relative', width: 360, height: 220 }}>
                <Box
                  component="svg"
                  viewBox="0 0 360 220"
                  sx={{ width: '100%', height: '100%', overflow: 'visible' }}
                >
                  <path
                    d={describeArc(180, 166, 112, -120, -60)}
                    fill="none"
                    stroke="#4f5ea6"
                    strokeWidth="15"
                    strokeLinecap="butt"
                  />
                  <path
                    d={describeArc(180, 166, 112, -60, 0)}
                    fill="none"
                    stroke="#39a6eb"
                    strokeWidth="15"
                    strokeLinecap="butt"
                  />
                  <path
                    d={describeArc(180, 166, 112, 0, 60)}
                    fill="none"
                    stroke="#41d478"
                    strokeWidth="15"
                    strokeLinecap="butt"
                  />
                  <path
                    d={describeArc(180, 166, 112, 60, 120)}
                    fill="none"
                    stroke="#b9ebf4"
                    strokeWidth="15"
                    strokeLinecap="butt"
                  />

                  {gaugeTicks.map((tick) => {
                    const outer = polarToCartesian(180, 166, 118, tick.angle)
                    const inner = polarToCartesian(
                      180,
                      166,
                      tick.major ? 108 : 112,
                      tick.angle,
                    )

                    return (
                      <line
                        key={tick.angle}
                        x1={outer.x}
                        y1={outer.y}
                        x2={inner.x}
                        y2={inner.y}
                        stroke={tick.major ? '#8f97a4' : '#d5dbe4'}
                        strokeWidth={tick.major ? 1.6 : 1}
                        strokeLinecap="round"
                      />
                    )
                  })}

                  {[
                    { label: '0', angle: -120, radius: 94 },
                    { label: '25', angle: -60, radius: 90 },
                    { label: '50', angle: 0, radius: 82 },
                    { label: '75', angle: 60, radius: 90 },
                    { label: '100', angle: 120, radius: 94 },
                  ].map((mark) => {
                    const point = polarToCartesian(180, 166, mark.radius, mark.angle)
                    return (
                      <text
                        key={mark.label}
                        x={point.x}
                        y={point.y}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fontSize="12"
                        fontWeight="500"
                        fill="#7f8794"
                      >
                        {mark.label}
                      </text>
                    )
                  })}

                  <line
                    x1="180"
                    y1="166"
                    x2={polarToCartesian(180, 166, 72, gaugeProgressAngle).x}
                    y2={polarToCartesian(180, 166, 72, gaugeProgressAngle).y}
                    stroke="#c0c4ca"
                    strokeWidth="5.5"
                    strokeLinecap="round"
                  />
                  <circle cx="180" cy="166" r="14" fill="#edf0f3" />
                  <circle cx="180" cy="166" r="4" fill="#4f5560" />
                </Box>

                <Box
                  sx={{
                    position: 'absolute',
                    left: '50%',
                    bottom: 6,
                    transform: 'translateX(-50%)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 0,
                  }}
                >
                  <Typography
                    sx={{
                      display: 'none',
                    }}
                  >
                    剩余流量 {remainingTrafficPercent}%
                  </Typography>
                  <Typography
                    sx={{
                      fontSize: 18,
                      fontWeight: 500,
                      color: '#a1a4aa',
                      lineHeight: 1,
                    }}
                  >
                    {remainingTrafficDisplay}
                  </Typography>
                </Box>
              </Box>
            </Box>

            <Button variant="contained" onClick={() => void onToggleProtection()} disabled={isTogglingProtection} startIcon={<PowerSettingsNewRounded />} sx={{ justifySelf: 'center', mt: -0.6, minWidth: 234, height: 36, borderRadius: 999, background: '#2688ea', boxShadow: 'none', fontWeight: 700, color: '#ffffff', '&:hover': { background: '#2688ea' } }}>
              {isTogglingProtection ? '处理中...' : isProtectionEnabled ? '断开连接' : '启动连接'}
            </Button>

          </Box>
        </Box>

        <Box sx={{ background: '#f7f8fc', px: 2.2, py: 2.1, display: 'flex', flexDirection: 'column', gap: 2.2 }}>
          {[{ label: '账户余额', value: formatCurrency(user?.balance) }, { label: '会员等级', value: packageLevel }, { label: '等级过期', value: packageExpireAt }].map((item) => (
            <Box key={item.label}>
              <Typography sx={{ fontSize: 13, color: '#8c97a9' }}>{item.label}</Typography>
              <Typography sx={{ mt: 0.6, fontSize: 15, fontWeight: 700, color: '#3b67de' }}>{item.value}</Typography>
            </Box>
          ))}

          <Box sx={{ flex: 1, minHeight: 0 }} />

          <Box sx={{ pt: 2.8, borderTop: '1px dashed rgba(19, 31, 53, 0.12)' }}>
              <Stack spacing={3}>
                <Button variant="contained" onClick={() => void openRechargePage()} sx={{ height: 34, borderRadius: 0, fontWeight: 700, background: '#5b62d6', boxShadow: 'none', color: '#ffffff', '&:hover': { background: '#5b62d6' } }}>{'\u4f59\u989d\u5145\u503c'}</Button>
                <Button variant="contained" onClick={() => void openPurchasePage()} sx={{ height: 34, borderRadius: 0, fontWeight: 700, background: '#5b62d6', boxShadow: 'none', color: '#ffffff', '&:hover': { background: '#5b62d6' } }}>{'\u8d2d\u4e70\u5957\u9910'}</Button>
                <Button variant="contained" onClick={() => void openSupportPage()} sx={{ height: 34, borderRadius: 0, fontWeight: 700, background: '#5b62d6', boxShadow: 'none', color: '#ffffff', '&:hover': { background: '#5b62d6' } }}>{'\u8054\u7cfb\u5ba2\u670d'}</Button>
                <Button variant="contained" onClick={() => void openInvitePage()} sx={{ height: 34, borderRadius: 0, fontWeight: 700, background: '#f4a120', boxShadow: 'none', color: '#ffffff', '&:hover': { background: '#f4a120' } }}>{'\u9080\u8bf7\u8fd4\u5229'}</Button>
              </Stack>
          </Box>
        </Box>
      </Box>
    </BasePage>
  )
}

export default HomePage
