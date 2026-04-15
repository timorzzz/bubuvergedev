import { ContentCopyRounded } from '@mui/icons-material'
import { Alert, Box, Chip, Divider, Stack, Typography } from '@mui/material'
import { open as openUrl } from '@tauri-apps/plugin-shell'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'

import { BaseDialog, DialogRef, TooltipIcon } from '@/components/base'
import { updateLastCheckTime } from '@/hooks/use-update'
import {
  exitApp,
} from '@/services/cmds'
import { showNotice } from '@/services/notice-service'
import { queryClient } from '@/services/query-client'
import { checkUpdateSafe as checkUpdate } from '@/services/update'
import { version } from '@root/package.json'

import { MiscViewer } from './mods/misc-viewer'
import { SettingItem, SettingList } from './mods/setting-comp'
import { ThemeViewer } from './mods/theme-viewer'

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

const SettingVergeAdvanced = ({ onError: _ }: Props) => {
  const { t } = useTranslation()

  const miscRef = useRef<DialogRef>(null)
  const themeRef = useRef<DialogRef>(null)
  const [updateDialog, setUpdateDialog] = useState<ManualUpdateDialogState>({
    open: false,
    type: 'info',
    title: '',
    content: '',
  })

  const closeUpdateDialog = useCallback(() => {
    setUpdateDialog((prev) => ({ ...prev, open: false }))
  }, [])

  const openUpdateDialog = useCallback(
    (payload: Omit<ManualUpdateDialogState, 'open'>) => {
      setUpdateDialog({ open: true, ...payload })
    },
    [],
  )

  const isMeaningfulMessage = useCallback((message?: string) => {
    if (!message) return false
    const normalized = message.trim().toLowerCase()
    return !['ok', 'success', 'true'].includes(normalized)
  }, [])

  const onCheckUpdate = async () => {
    try {
      const info = await checkUpdate()
      updateLastCheckTime()
      queryClient.setQueryData(['checkUpdate'], info)
      if (!info) {
        openUpdateDialog({
          type: 'error',
          title: '\u68c0\u67e5\u66f4\u65b0',
          content: '\u68c0\u67e5\u66f4\u65b0\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5',
        })
        return
      }
      if (info.checkFailed) {
        console.error('[pc-update]', info.message, info.rawJson)
        openUpdateDialog({
          type: 'error',
          title: '\u68c0\u67e5\u66f4\u65b0',
          content:
            info.message ||
            '\u68c0\u67e5\u66f4\u65b0\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5',
          version: info.version,
          currentVersion: info.currentVersion,
        })
        return
      }
      if (!info?.available) {
        openUpdateDialog({
          type: 'success',
          title: '\u5df2\u662f\u6700\u65b0\u7248\u672c',
          content: '\u5f53\u524d\u662f\u6700\u65b0\u7248\u672c\uff0c\u65e0\u9700\u66f4\u65b0\u3002',
          version: info.version,
          currentVersion: info.currentVersion,
        })
      } else {
        openUpdateDialog({
          type: 'info',
          title: `\u53d1\u73b0\u65b0\u7248\u672c ${info.version}`,
          content:
            info.body ||
            '\u68c0\u6d4b\u5230\u65b0\u7248\u672c\uff0c\u53ef\u4ee5\u5f00\u59cb\u4e0b\u8f7d\u66f4\u65b0\u3002',
          version: info.version,
          currentVersion: info.currentVersion,
          downloadUrl: info.downloadUrl,
        })
      }
    } catch (err: any) {
      openUpdateDialog({
        type: 'error',
        title: '\u68c0\u67e5\u66f4\u65b0',
        content:
          err instanceof Error
            ? err.message
            : String(err || '\u68c0\u67e5\u66f4\u65b0\u5931\u8d25'),
      })
    }
  }

  const copyVersion = useCallback(() => {
    navigator.clipboard.writeText(`v${version}`).then(() => {
      showNotice.success(
        'settings.components.verge.advanced.notifications.versionCopied',
        1000,
      )
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
    () =>
      updateDialog.content ||
      '\u6682\u65e0\u66f4\u65b0\u4fe1\u606f',
    [updateDialog.content],
  )

  const shouldShowDetailBox = useMemo(
    () => updateDialog.type !== 'success' || Boolean(updateDialog.downloadUrl),
    [updateDialog.downloadUrl, updateDialog.type],
  )

  const statusLabel = useMemo(() => {
    if (updateDialog.type === 'error') return '\u68c0\u67e5\u5931\u8d25'
    if (updateDialog.downloadUrl) return '\u53ef\u4ee5\u66f4\u65b0'
    return '\u5df2\u662f\u6700\u65b0'
  }, [updateDialog.downloadUrl, updateDialog.type])

  const statusColor = useMemo(() => {
    if (updateDialog.type === 'error') return 'error'
    if (updateDialog.downloadUrl) return 'warning'
    return 'success'
  }, [updateDialog.downloadUrl, updateDialog.type])

  return (
    <SettingList title={t('settings.components.verge.advanced.title')}>
      <BaseDialog
        open={updateDialog.open}
        title={updateDialog.title || '\u68c0\u67e5\u66f4\u65b0'}
        okBtn={
          updateDialog.downloadUrl
            ? '\u7acb\u5373\u4e0b\u8f7d'
            : '\u77e5\u9053\u4e86'
        }
        cancelBtn={updateDialog.downloadUrl ? '\u53d6\u6d88' : undefined}
        disableCancel={!updateDialog.downloadUrl}
        onOk={updateDialog.downloadUrl ? onOpenDownloadUrl : closeUpdateDialog}
        onCancel={closeUpdateDialog}
        onClose={closeUpdateDialog}
        contentSx={{ minWidth: 380, maxWidth: 520, maxHeight: '60vh', pt: 1.5 }}
      >
        <Stack spacing={2} sx={{ maxHeight: '52vh', overflow: 'auto' }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
            <Chip
              label={statusLabel}
              color={statusColor}
              variant={updateDialog.downloadUrl ? 'filled' : 'outlined'}
              size="small"
            />
            {updateDialog.currentVersion && (
              <Chip
                label={`\u5f53\u524d\u7248\u672c ${updateDialog.currentVersion}`}
                variant="outlined"
                size="small"
              />
            )}
            {updateDialog.version && (
              <Chip
                label={`\u76ee\u6807\u7248\u672c ${updateDialog.version}`}
                variant="outlined"
                size="small"
              />
            )}
          </Stack>

          {!updateDialog.downloadUrl && updateDialog.type === 'success' && (
            <Alert severity="success" variant="outlined">
              {'\u5f53\u524d\u5ba2\u6237\u7aef\u5df2\u662f\u6700\u65b0\u7248\u672c\u3002'}
            </Alert>
          )}

          {updateDialog.type === 'error' && (
            <Alert severity="error" variant="outlined">
              {'\u66f4\u65b0\u68c0\u67e5\u672a\u6210\u529f\uff0c\u8bf7\u67e5\u770b\u4e0b\u65b9\u8be6\u7ec6\u4fe1\u606f\u3002'}
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
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: 'block', mb: 1 }}
                >
                  {updateDialog.type === 'error'
                    ? '\u8fd4\u56de\u4fe1\u606f'
                    : '\u66f4\u65b0\u8bf4\u660e'}
                </Typography>
                <ReactMarkdown rehypePlugins={[rehypeRaw]}>
                  {updateDialogMarkdown}
                </ReactMarkdown>
              </Box>
            </>
          )}
        </Stack>
      </BaseDialog>
      <ThemeViewer ref={themeRef} />
      <MiscViewer ref={miscRef} />

      <SettingItem
        onClick={onCheckUpdate}
        label={t('settings.components.verge.advanced.fields.checkUpdates')}
      />

      <SettingItem
        onClick={() => {
          exitApp()
        }}
        label={t('settings.components.verge.advanced.fields.exit')}
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
    </SettingList>
  )
}

export default SettingVergeAdvanced
