import { ContentCopyRounded, LanRounded, SettingsRounded } from '@mui/icons-material'
import { Alert, Box, Chip, Divider, MenuItem, Select, Stack, Switch, TextField, Typography } from '@mui/material'
import { invoke } from '@tauri-apps/api/core'
import { open as openUrl } from '@tauri-apps/plugin-shell'
import { useLockFn } from 'ahooks'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'

import { BaseDialog, DialogRef, TooltipIcon } from '@/components/base'
import { useClash } from '@/hooks/use-clash'
import { updateLastCheckTime } from '@/hooks/use-update'
import { useVerge } from '@/hooks/use-verge'
import { exitApp } from '@/services/cmds'
import { showNotice } from '@/services/notice-service'
import { queryClient } from '@/services/query-client'
import { checkUpdateSafe as checkUpdate } from '@/services/update'
import getSystem from '@/utils/get-system'
import { version } from '@root/package.json'

import { ClashCoreViewer } from './mods/clash-core-viewer'
import { ClashPortViewer } from './mods/clash-port-viewer'
import { DnsViewer } from './mods/dns-viewer'
import { GuardState } from './mods/guard-state'
import { NetworkInterfaceViewer } from './mods/network-interface-viewer'
import { SettingItem, SettingList } from './mods/setting-comp'

interface Props {
  onError?: (err: Error) => void
}

type ManualUpdateDialogState = {
  open: boolean
  type: 'success' | 'info' | 'error'
  title: string
  content: string
  version?: string
  currentVersion?: string
  downloadUrl?: string
}

const OS = getSystem()

const SettingVergeAdvanced = ({ onError }: Props) => {
  const { t } = useTranslation()
  const { verge, patchVerge, mutateVerge } = useVerge()
  const { clash, version: clashCoreVersion, mutateClash, patchClash } = useClash()

  const { tray_event, verge_mixed_port } = verge ?? {}
  const { ipv6, 'allow-lan': allowLan, 'unified-delay': unifiedDelay } = clash ?? {}

  const [dnsSettingsEnabled, setDnsSettingsEnabled] = useState(() => verge?.enable_dns_settings ?? false)
  const [updateDialog, setUpdateDialog] = useState<ManualUpdateDialogState>({
    open: false,
    type: 'info',
    title: '',
    content: '',
  })

  const portRef = useRef<DialogRef>(null)
  const coreRef = useRef<DialogRef>(null)
  const networkRef = useRef<DialogRef>(null)
  const dnsRef = useRef<DialogRef>(null)

  const onSwitchFormat = (_e: any, value: boolean) => value
  const onChangeVerge = (patch: any) => {
    mutateVerge({ ...verge, ...patch }, false)
  }
  const onChangeClash = (patch: Partial<IConfigData>) => {
    mutateClash((old) => ({ ...old!, ...patch }), false)
  }

  const handleDnsToggle = useLockFn(async (enable: boolean) => {
    try {
      setDnsSettingsEnabled(enable)
      await patchVerge({ enable_dns_settings: enable })
      await invoke('apply_dns_config', { apply: enable })
      setTimeout(() => {
        mutateClash()
      }, 500)
    } catch (err: any) {
      setDnsSettingsEnabled(!enable)
      throw err
    }
  })

  const closeUpdateDialog = useCallback(() => {
    setUpdateDialog((prev) => ({ ...prev, open: false }))
  }, [])

  const openUpdateDialog = useCallback((payload: Omit<ManualUpdateDialogState, 'open'>) => {
    setUpdateDialog({ open: true, ...payload })
  }, [])

  const onCheckUpdate = async () => {
    try {
      const info = await checkUpdate()
      updateLastCheckTime()
      queryClient.setQueryData(['checkUpdate'], info)

      if (!info) {
        openUpdateDialog({
          type: 'error',
          title: '检查更新',
          content: '检查更新失败，请稍后重试',
        })
        return
      }

      if (info.checkFailed) {
        console.error('[pc-update]', info.message, info.rawJson)
        openUpdateDialog({
          type: 'error',
          title: '检查更新',
          content: info.message || '检查更新失败，请稍后重试',
          version: info.version,
          currentVersion: info.currentVersion,
        })
        return
      }

      if (!info.available) {
        openUpdateDialog({
          type: 'success',
          title: '已是最新版本',
          content: '当前是最新版本，无需更新。',
          version: info.version,
          currentVersion: info.currentVersion,
        })
      } else {
        openUpdateDialog({
          type: 'info',
          title: `发现新版本 ${info.version}`,
          content: info.body || '检测到新版本，可以开始下载更新。',
          version: info.version,
          currentVersion: info.currentVersion,
          downloadUrl: info.downloadUrl,
        })
      }
    } catch (err: any) {
      openUpdateDialog({
        type: 'error',
        title: '检查更新',
        content: err instanceof Error ? err.message : String(err || '检查更新失败'),
      })
    }
  }

  const copyVersion = useCallback(() => {
    navigator.clipboard.writeText(`v${version}`).then(() => {
      showNotice.success('settings.components.verge.advanced.notifications.versionCopied', 1000)
    })
  }, [])

  const onOpenDownloadUrl = useCallback(async () => {
    if (!updateDialog.downloadUrl) return
    try {
      await openUrl(updateDialog.downloadUrl)
      closeUpdateDialog()
    } catch (err) {
      showNotice.error(err)
    }
  }, [closeUpdateDialog, updateDialog.downloadUrl])

  const updateDialogMarkdown = useMemo(
    () => updateDialog.content || '暂无更新信息',
    [updateDialog.content],
  )

  const shouldShowDetailBox = useMemo(
    () => updateDialog.type !== 'success' || Boolean(updateDialog.downloadUrl),
    [updateDialog.downloadUrl, updateDialog.type],
  )

  const statusLabel = useMemo(() => {
    if (updateDialog.type === 'error') return '检查失败'
    if (updateDialog.downloadUrl) return '可以更新'
    return '已是最新'
  }, [updateDialog.downloadUrl, updateDialog.type])

  const statusColor = useMemo(() => {
    if (updateDialog.type === 'error') return 'error'
    if (updateDialog.downloadUrl) return 'warning'
    return 'success'
  }, [updateDialog.downloadUrl, updateDialog.type])

  return (
    <SettingList title={'Bluelayer 高级设置'}>
      <ClashPortViewer ref={portRef} />
      <ClashCoreViewer ref={coreRef} />
      <NetworkInterfaceViewer ref={networkRef} />
      <DnsViewer ref={dnsRef} />

      <BaseDialog
        open={updateDialog.open}
        title={updateDialog.title || '检查更新'}
        okBtn={updateDialog.downloadUrl ? '立即下载' : '知道了'}
        cancelBtn={updateDialog.downloadUrl ? '取消' : undefined}
        disableCancel={!updateDialog.downloadUrl}
        onOk={updateDialog.downloadUrl ? onOpenDownloadUrl : closeUpdateDialog}
        onCancel={closeUpdateDialog}
        onClose={closeUpdateDialog}
        contentSx={{ minWidth: 380, maxWidth: 520, maxHeight: '60vh', pt: 1.5 }}
      >
        <Stack spacing={2} sx={{ maxHeight: '52vh', overflow: 'auto' }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
            <Chip label={statusLabel} color={statusColor} variant={updateDialog.downloadUrl ? 'filled' : 'outlined'} size="small" />
            {updateDialog.currentVersion && <Chip label={`当前版本 ${updateDialog.currentVersion}`} variant="outlined" size="small" />}
            {updateDialog.version && <Chip label={`目标版本 ${updateDialog.version}`} variant="outlined" size="small" />}
          </Stack>

          {!updateDialog.downloadUrl && updateDialog.type === 'success' && (
            <Alert severity="success" variant="outlined">
              {'当前客户端已是最新版本。'}
            </Alert>
          )}

          {updateDialog.type === 'error' && (
            <Alert severity="error" variant="outlined">
              {'更新检查未成功，请查看下方详细信息。'}
            </Alert>
          )}

          {shouldShowDetailBox && (
            <>
              <Divider />
              <Box
                sx={{
                  px: 1.5,
                  py: 1.25,
                  borderRadius: 2,
                  bgcolor: 'background.paper',
                  border: (theme) => `1px solid ${theme.palette.divider}`,
                }}
              >
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                  {updateDialog.type === 'error' ? '返回信息' : '更新说明'}
                </Typography>
                <ReactMarkdown rehypePlugins={[rehypeRaw]}>{updateDialogMarkdown}</ReactMarkdown>
              </Box>
            </>
          )}
        </Stack>
      </BaseDialog>

      {OS !== 'linux' && (
        <SettingItem label={t('settings.components.verge.basic.fields.trayClickEvent')}>
          <GuardState
            value={tray_event ?? 'main_window'}
            onCatch={onError}
            onFormat={(e: any) => e.target.value}
            onChange={(e) => onChangeVerge({ tray_event: e })}
            onGuard={(e) => patchVerge({ tray_event: e })}
          >
            <Select size="small" sx={{ width: 140, '> div': { py: '7.5px' } }}>
              <MenuItem value="main_window">
                {t('settings.components.verge.basic.trayOptions.showMainWindow')}
              </MenuItem>
              <MenuItem value="tray_menu">
                {t('settings.components.verge.basic.trayOptions.showTrayMenu')}
              </MenuItem>
              <MenuItem value="system_proxy">
                {t('settings.sections.system.toggles.systemProxy')}
              </MenuItem>
              <MenuItem value="tun_mode">
                {t('settings.sections.system.toggles.tunMode')}
              </MenuItem>
              <MenuItem value="disable">
                {t('settings.components.verge.basic.trayOptions.disable')}
              </MenuItem>
            </Select>
          </GuardState>
        </SettingItem>
      )}

      <SettingItem
        label={t('settings.sections.clash.form.fields.allowLan')}
        extra={
          <TooltipIcon
            title={t('settings.sections.clash.form.tooltips.networkInterface')}
            color="inherit"
            icon={LanRounded}
            onClick={() => networkRef.current?.open()}
          />
        }
      >
        <GuardState
          value={allowLan ?? false}
          valueProps="checked"
          onCatch={onError}
          onFormat={onSwitchFormat}
          onChange={(e) => onChangeClash({ 'allow-lan': e })}
          onGuard={(e) => patchClash({ 'allow-lan': e })}
        >
          <Switch edge="end" />
        </GuardState>
      </SettingItem>

      <SettingItem
        label={t('settings.sections.clash.form.fields.dnsOverwrite')}
        extra={<TooltipIcon icon={SettingsRounded} onClick={() => dnsRef.current?.open()} />}
      >
        <Switch edge="end" checked={dnsSettingsEnabled} onChange={(_, checked) => handleDnsToggle(checked)} />
      </SettingItem>

      <SettingItem label={t('settings.sections.clash.form.fields.ipv6')}>
        <GuardState
          value={ipv6 ?? false}
          valueProps="checked"
          onCatch={onError}
          onFormat={onSwitchFormat}
          onChange={(e) => onChangeClash({ ipv6: e })}
          onGuard={(e) => patchClash({ ipv6: e })}
        >
          <Switch edge="end" />
        </GuardState>
      </SettingItem>

      <SettingItem
        label={t('settings.sections.clash.form.fields.unifiedDelay')}
        extra={<TooltipIcon title={t('settings.sections.clash.form.tooltips.unifiedDelay')} sx={{ opacity: '0.7' }} />}
      >
        <GuardState
          value={unifiedDelay ?? false}
          valueProps="checked"
          onCatch={onError}
          onFormat={onSwitchFormat}
          onChange={(e) => onChangeClash({ 'unified-delay': e })}
          onGuard={(e) => patchClash({ 'unified-delay': e })}
        >
          <Switch edge="end" />
        </GuardState>
      </SettingItem>

      <SettingItem label={t('settings.sections.clash.form.fields.portConfig')}>
        <TextField
          autoComplete="new-password"
          disabled={false}
          size="small"
          value={verge_mixed_port ?? 7897}
          sx={{ width: 100, input: { py: '7.5px', cursor: 'pointer' } }}
          onClick={(e) => {
            portRef.current?.open()
            ;(e.target as any).blur()
          }}
        />
      </SettingItem>

      <SettingItem
        label={t('settings.sections.clash.form.fields.clashCore')}
        extra={<TooltipIcon icon={SettingsRounded} onClick={() => coreRef.current?.open()} />}
      >
        <Typography sx={{ py: '7px', pr: 1 }}>{clashCoreVersion}</Typography>
      </SettingItem>

      <SettingItem
        onClick={onCheckUpdate}
        label={t('settings.components.verge.advanced.fields.checkUpdates')}
      />

      <SettingItem
        label={t('settings.components.verge.advanced.fields.vergeVersion')}
        extra={
          <TooltipIcon
            icon={ContentCopyRounded}
            onClick={copyVersion}
            title={t('settings.components.verge.advanced.actions.copyVersion')}
          />
        }
      >
        <Typography sx={{ py: '7px', pr: 1 }}>Bluelayer 加速器 v{version}</Typography>
      </SettingItem>

      <SettingItem
        onClick={() => {
          exitApp()
        }}
        label={t('settings.components.verge.advanced.fields.exit')}
      />
    </SettingList>
  )
}

export default SettingVergeAdvanced
