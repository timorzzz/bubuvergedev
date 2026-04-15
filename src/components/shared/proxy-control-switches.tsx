import {
  BuildRounded,
  DeleteForeverRounded,
  PauseCircleOutlineRounded,
  PlayCircleOutlineRounded,
  SettingsRounded,
  WarningRounded,
} from '@mui/icons-material'
import { Box, Typography, alpha, useTheme } from '@mui/material'
import { useLockFn } from 'ahooks'
import React, { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DialogRef, Switch, TooltipIcon } from '@/components/base'
import { SysproxyViewer } from '@/components/setting/mods/sysproxy-viewer'
import { TunViewer } from '@/components/setting/mods/tun-viewer'
import { useServiceInstaller } from '@/hooks/use-service-installer'
import { useServiceUninstaller } from '@/hooks/use-service-uninstaller'
import { useSystemProxyState } from '@/hooks/use-system-proxy-state'
import { useSystemState } from '@/hooks/use-system-state'
import { useVerge } from '@/hooks/use-verge'
import { showNotice } from '@/services/notice-service'

interface ProxySwitchProps {
  label?: string
  onError?: (err: Error) => void
  noRightPadding?: boolean
}

interface SwitchRowProps {
  label: string
  description?: string
  active: boolean
  disabled?: boolean
  infoTitle: string
  tag?: string
  statusText?: string
  statusTone?: 'success' | 'warning' | 'default'
  onInfoClick?: () => void
  extraIcons?: React.ReactNode
  onToggle: (value: boolean) => Promise<void>
  onError?: (err: Error) => void
  highlight?: boolean
}

const SwitchRow = ({
  label,
  description,
  active,
  disabled,
  infoTitle,
  tag,
  statusText,
  statusTone = 'default',
  onInfoClick,
  extraIcons,
  onToggle,
  onError,
  highlight,
}: SwitchRowProps) => {
  const theme = useTheme()
  const [checked, setChecked] = useState(active)
  const pendingRef = useRef(false)

  if (pendingRef.current) {
    if (active === checked) pendingRef.current = false
  } else if (checked !== active) {
    setChecked(active)
  }

  const handleChange = (_: React.ChangeEvent, value: boolean) => {
    pendingRef.current = true
    setChecked(value)
    onToggle(value)
      .catch((err: any) => {
        setChecked(active)
        onError?.(err)
      })
      .finally(() => {
        pendingRef.current = false
      })
  }

  const statusSx = useMemo(() => {
    if (statusTone === 'success') {
      return {
        color: 'success.main',
        bgcolor: alpha(theme.palette.success.main, 0.1),
      }
    }
    if (statusTone === 'warning') {
      return {
        color: 'warning.main',
        bgcolor: alpha(theme.palette.warning.main, 0.12),
      }
    }
    return {
      color: 'text.secondary',
      bgcolor: alpha(theme.palette.text.primary, 0.06),
    }
  }, [statusTone, theme])

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 1.5,
        p: 1.2,
        pr: 2,
        borderRadius: 1.8,
        bgcolor: highlight
          ? alpha(theme.palette.success.main, 0.07)
          : 'transparent',
        opacity: disabled ? 0.6 : 1,
        transition: 'background-color 0.3s',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.1, flex: 1, minWidth: 0 }}>
        {active ? (
          <PlayCircleOutlineRounded
            sx={{ color: 'success.main', mt: '2px', flexShrink: 0 }}
          />
        ) : (
          <PauseCircleOutlineRounded
            sx={{ color: 'text.disabled', mt: '2px', flexShrink: 0 }}
          />
        )}

        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, flexWrap: 'wrap' }}>
            <Typography
              variant="subtitle1"
              sx={{ fontWeight: 600, fontSize: '15px', lineHeight: 1.25 }}
            >
              {label}
            </Typography>

            {tag ? (
              <Box
                sx={{
                  px: 0.8,
                  py: 0.2,
                  borderRadius: 999,
                  fontSize: 11,
                  lineHeight: 1.4,
                  color: highlight ? 'success.main' : 'text.secondary',
                  bgcolor: highlight
                    ? alpha(theme.palette.success.main, 0.1)
                    : alpha(theme.palette.text.primary, 0.06),
                }}
              >
                {tag}
              </Box>
            ) : null}

            <TooltipIcon
              title={infoTitle}
              icon={SettingsRounded}
              onClick={onInfoClick}
              sx={{ ml: 0.2 }}
            />

            {extraIcons}
          </Box>

          {!!description && (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ mt: 0.45, lineHeight: 1.45 }}
            >
              {description}
            </Typography>
          )}

          {!!statusText && (
            <Box
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                mt: 0.75,
                px: 0.9,
                py: 0.35,
                borderRadius: 999,
                fontSize: 12,
                lineHeight: 1.3,
                ...statusSx,
              }}
            >
              {statusText}
            </Box>
          )}
        </Box>
      </Box>

      <Switch
        edge="end"
        disabled={disabled}
        checked={checked}
        onChange={handleChange}
        sx={{ mt: 0.2, flexShrink: 0 }}
      />
    </Box>
  )
}

const ProxyControlSwitches = ({
  label,
  onError,
  noRightPadding = false,
}: ProxySwitchProps) => {
  const { t, i18n } = useTranslation()
  const { verge, mutateVerge, patchVerge } = useVerge()
  const { installServiceAndRestartCore } = useServiceInstaller()
  const { uninstallServiceAndRestartCore } = useServiceUninstaller()
  const {
    indicator: systemProxyIndicator,
    configState: systemProxyConfigState,
    toggleSystemProxy,
  } = useSystemProxyState()
  const { isServiceOk, isTunModeAvailable, mutateSystemState } =
    useSystemState()

  const sysproxyRef = useRef<DialogRef>(null)
  const tunRef = useRef<DialogRef>(null)

  const { enable_tun_mode } = verge ?? {}
  const isZh = /^(zh|zh-|zhtw)/i.test(i18n.resolvedLanguage || i18n.language || '')

  const showErrorNotice = useCallback(
    (msg: string) => showNotice.error(msg),
    [],
  )

  const handleTunToggle = async (value: boolean) => {
    if (!isTunModeAvailable) {
      const msgKey = 'settings.sections.proxyControl.tooltips.tunUnavailable'
      showErrorNotice(msgKey)
      throw new Error(t(msgKey))
    }
    mutateVerge({ ...verge, enable_tun_mode: value }, false)
    await patchVerge({ enable_tun_mode: value })
  }

  const onInstallService = useLockFn(async () => {
    try {
      await installServiceAndRestartCore()
      await mutateSystemState()
    } catch (err) {
      showNotice.error(err)
    }
  })

  const onUninstallService = useLockFn(async () => {
    try {
      if (verge?.enable_tun_mode) {
        await handleTunToggle(false)
      }
      await uninstallServiceAndRestartCore()
      await mutateSystemState()
    } catch (err) {
      showNotice.error(err)
    }
  })

  const isSystemProxyMode =
    label === t('settings.sections.system.toggles.systemProxy') || !label
  const isTunMode = label === t('settings.sections.system.toggles.tunMode')

  const systemProxyActive =
    (systemProxyConfigState ?? false) || systemProxyIndicator

  const systemProxyLabel = isZh ? '\u7cfb\u7edf\u4ee3\u7406' : 'System Proxy'
  const tunLabel = isZh ? 'TUN\u6a21\u5f0f' : 'TUN Mode'

  const systemProxyStatusText = isZh
    ? systemProxyIndicator
      ? '已生效'
      : systemProxyConfigState
        ? '正在应用中'
        : '未开启'
    : systemProxyIndicator
      ? 'Active'
      : systemProxyConfigState
        ? 'Applying'
        : 'Off'

  const systemProxyStatusTone: 'success' | 'warning' | 'default' =
    systemProxyIndicator
      ? 'success'
      : systemProxyConfigState
        ? 'warning'
        : 'default'

  const tunDescription = isZh
    ? enable_tun_mode
      ? '已接管全部流量，通常不需要再开启系统代理。'
      : isTunModeAvailable
        ? '只有当部分软件在系统代理模式下无法使用时，再开启这个模式。'
        : '当前不可用，需要安装服务或以管理员身份运行后才能开启。'
    : enable_tun_mode
      ? 'All traffic is now handled by TUN mode. You usually do not need system proxy as well.'
      : isTunModeAvailable
        ? 'Use this only when some apps do not work under system proxy mode.'
        : 'Unavailable now. Install the service or run as administrator first.'

  const tunStatusText = isZh
    ? enable_tun_mode
      ? '已接管全部流量'
      : isTunModeAvailable
        ? '仅在特殊软件下需要'
        : '需要先安装服务'
    : enable_tun_mode
      ? 'Handling all traffic'
      : isTunModeAvailable
        ? 'Only for special apps'
        : 'Service required'

  return (
    <Box sx={{ width: '100%', pr: noRightPadding ? 1 : 2 }}>
      {isSystemProxyMode && (
        <SwitchRow
          label={systemProxyLabel}
          tag={isZh ? '优先使用' : 'Recommended'}
          statusText={systemProxyStatusText}
          statusTone={systemProxyStatusTone}
          active={systemProxyActive}
          infoTitle={t('settings.sections.proxyControl.tooltips.systemProxy')}
          onInfoClick={() => sysproxyRef.current?.open()}
          onToggle={(value) => toggleSystemProxy(value)}
          onError={onError}
          highlight={systemProxyActive}
        />
      )}

      {isTunMode && (
        <SwitchRow
          label={tunLabel}
          description={tunDescription}
          tag={isZh ? '系统代理不生效时再开' : 'Use only if needed'}
          statusText={tunStatusText}
          statusTone={enable_tun_mode ? 'success' : isTunModeAvailable ? 'default' : 'warning'}
          active={enable_tun_mode || false}
          infoTitle={t('settings.sections.proxyControl.tooltips.tunMode')}
          onInfoClick={() => tunRef.current?.open()}
          onToggle={handleTunToggle}
          onError={onError}
          disabled={!isTunModeAvailable}
          highlight={enable_tun_mode || false}
          extraIcons={
            <>
              {!isTunModeAvailable && (
                <>
                  <TooltipIcon
                    title={t(
                      'settings.sections.proxyControl.tooltips.tunUnavailable',
                    )}
                    icon={WarningRounded}
                    sx={{ color: 'warning.main', ml: 1 }}
                  />
                  <TooltipIcon
                    title={t(
                      'settings.sections.proxyControl.actions.installService',
                    )}
                    icon={BuildRounded}
                    color="primary"
                    onClick={onInstallService}
                    sx={{ ml: 1 }}
                  />
                </>
              )}
              {isServiceOk && (
                <TooltipIcon
                  title={t(
                    'settings.sections.proxyControl.actions.uninstallService',
                  )}
                  icon={DeleteForeverRounded}
                  color="secondary"
                  onClick={onUninstallService}
                  sx={{ ml: 1 }}
                />
              )}
            </>
          }
        />
      )}

      <SysproxyViewer ref={sysproxyRef} />
      <TunViewer ref={tunRef} />
    </Box>
  )
}

export default ProxyControlSwitches
