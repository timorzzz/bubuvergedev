import { Box, Button } from '@mui/material'
import { open as openUrl } from '@tauri-apps/plugin-shell'
import type { Ref } from 'react'
import { useImperativeHandle, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'

import { BaseDialog, DialogRef } from '@/components/base'
import { useUpdate } from '@/hooks/use-update'
import { showNotice } from '@/services/notice-service'

export function UpdateViewer({ ref }: { ref?: Ref<DialogRef> }) {
  const { t } = useTranslation()

  const [open, setOpen] = useState(false)
  const { updateInfo } = useUpdate(false)

  useImperativeHandle(ref, () => ({
    open: () => setOpen(true),
    close: () => setOpen(false),
  }))

  const markdownContent = useMemo(() => {
    if (!updateInfo?.body) {
      return 'New Version is available'
    }
    return updateInfo?.body
  }, [updateInfo])

  const breakChangeFlag = useMemo(() => {
    if (!updateInfo?.body) {
      return false
    }
    return updateInfo?.body.toLowerCase().includes('break change')
  }, [updateInfo])

  const onUpdate = async () => {
    if (!updateInfo?.downloadUrl) {
      showNotice.error('\u672a\u83b7\u53d6\u5230\u66f4\u65b0\u4e0b\u8f7d\u5730\u5740')
      return
    }
    if (breakChangeFlag) {
      showNotice.error('settings.modals.update.messages.breakChangeError')
      return
    }
    try {
      await openUrl(updateInfo.downloadUrl)
      setOpen(false)
    } catch (err: any) {
      showNotice.error(err)
    }
  }

  return (
    <BaseDialog
      open={open}
      title={
        <Box display="flex" justifyContent="space-between">
          {t('settings.modals.update.title', {
            version: updateInfo?.version ?? '',
          })}
          <Box>
            <Button
              variant="contained"
              size="small"
              onClick={() => {
                if (updateInfo?.downloadUrl) {
                  openUrl(updateInfo.downloadUrl)
                }
              }}
              disabled={!updateInfo?.downloadUrl}
            >
              {t('settings.modals.update.actions.goToRelease')}
            </Button>
          </Box>
        </Box>
      }
      contentSx={{ minWidth: 360, maxWidth: 400, height: '50vh' }}
      okBtn={t('settings.modals.update.actions.update')}
      cancelBtn={t('shared.actions.cancel')}
      onClose={() => setOpen(false)}
      onCancel={() => setOpen(false)}
      onOk={onUpdate}
    >
      <Box sx={{ height: 'calc(100% - 10px)', overflow: 'auto' }}>
        <ReactMarkdown
          rehypePlugins={[rehypeRaw]}
          components={{
            a: ({ ...props }) => {
              const { children } = props
              return (
                <a {...props} target="_blank">
                  {children}
                </a>
              )
            },
          }}
        >
          {markdownContent}
        </ReactMarkdown>
      </Box>
    </BaseDialog>
  )
}
