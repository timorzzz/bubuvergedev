import { CheckCircleOutlineRounded } from '@mui/icons-material'
import { alpha, Box, ListItemButton, styled, Typography } from '@mui/material'
import { invoke } from '@tauri-apps/api/core'
import { useLockFn } from 'ahooks'
import { useCallback, useEffect, useReducer } from 'react'
import { useTranslation } from 'react-i18next'

import { BaseLoading } from '@/components/base'
import { useVerge } from '@/hooks/use-verge'
import { maybeAutoEnableDnsOverwrite } from '@/services/bluelayer-dns'
import { showNotice } from '@/services/notice-service'
import delayManager, { DelayUpdate } from '@/services/delay'

interface Props {
  group: IProxyGroupItem
  proxy: IProxyItem
  selected: boolean
  showType?: boolean
  onClick?: (name: string) => void
}

const Widget = styled(Box)(() => ({
  padding: '3px 6px',
  fontSize: 14,
  borderRadius: '4px',
}))

const TypeBox = styled('span')(({ theme }) => ({
  display: 'inline-block',
  border: '1px solid #ccc',
  borderColor: alpha(theme.palette.text.secondary, 0.36),
  color: alpha(theme.palette.text.secondary, 0.42),
  borderRadius: 4,
  fontSize: 10,
  marginRight: '4px',
  padding: '0 2px',
  lineHeight: 1.25,
}))

export const ProxyItemMini = (props: Props) => {
  const { group, proxy, selected, showType = false, onClick } = props
  const { t } = useTranslation()

  const presetList = ['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'COMPATIBLE']
  const isPreset = presetList.includes(proxy.name)
  const [delayState, setDelayState] = useReducer(
    (_: DelayUpdate, next: DelayUpdate) => next,
    { delay: -1, updatedAt: 0 },
  )
  const { verge, patchVerge } = useVerge()
  const timeout = verge?.default_latency_timeout || 10000

  useEffect(() => {
    if (isPreset) return
    delayManager.setListener(proxy.name, group.name, setDelayState)
    return () => {
      delayManager.removeListener(proxy.name, group.name)
    }
  }, [isPreset, proxy.name, group.name])

  const updateDelay = useCallback(() => {
    const cachedUpdate = delayManager.getDelayUpdate(proxy.name, group.name)
    if (cachedUpdate) {
      setDelayState({ ...cachedUpdate })
      return
    }

    const fallbackDelay = delayManager.getDelayFix(proxy, group.name)
    if (fallbackDelay === -1) {
      setDelayState({ delay: -1, updatedAt: 0 })
      return
    }

    let updatedAt = 0
    const history = proxy.history
    if (history && history.length > 0) {
      const lastRecord = history[history.length - 1]
      const parsed = Date.parse(lastRecord.time)
      if (!Number.isNaN(parsed)) updatedAt = parsed
    }

    setDelayState({ delay: fallbackDelay, updatedAt })
  }, [proxy, group.name])

  useEffect(() => {
    updateDelay()
  }, [updateDelay])

  const onDelay = useLockFn(async () => {
    setDelayState({ delay: -2, updatedAt: Date.now() })
    const result = await delayManager.checkDelay(proxy.name, group.name, timeout)
    setDelayState(result)

    if (result.delay === 0 || (result.delay >= timeout && result.delay <= 1e5)) {
      await maybeAutoEnableDnsOverwrite(verge?.enable_dns_settings, async (value) => {
        await patchVerge({ enable_dns_settings: value })
        await invoke('apply_dns_config', { apply: value })
      }).catch((error) => {
        console.error('[Bluelayer DNS] 自动开启覆写DNS失败', error)
        showNotice.error('覆写DNS 自动开启失败，请手动尝试')
      })
    }
  })

  const delayValue = delayState.delay

  return (
    <ListItemButton
      dense
      selected={selected}
      onClick={() => onClick?.(proxy.name)}
      sx={[
        {
          height: 56,
          borderRadius: 1.5,
          pl: 1.5,
          pr: 1,
          justifyContent: 'space-between',
          alignItems: 'center',
        },
        ({ palette: { mode, primary } }) => {
          const bgcolor = mode === 'light' ? '#ffffff' : '#24252f'
          const showDelay = delayValue > 0
          const selectColor = mode === 'light' ? primary.main : primary.light

          return {
            '&:hover .the-check': { display: !showDelay ? 'block' : 'none' },
            '&:hover .the-delay': { display: showDelay ? 'block' : 'none' },
            '&:hover .the-icon': { display: 'none' },
            '& .the-pin, & .the-unpin': {
              position: 'absolute',
              fontSize: '12px',
              top: '-5px',
              right: '-5px',
            },
            '& .the-unpin': { filter: 'grayscale(1)' },
            '&.Mui-selected': {
              width: `calc(100% + 3px)`,
              marginLeft: `-3px`,
              borderLeft: `3px solid ${selectColor}`,
              bgcolor:
                mode === 'light'
                  ? alpha(primary.main, 0.15)
                  : alpha(primary.main, 0.35),
            },
            backgroundColor: bgcolor,
          }
        },
      ]}
    >
      <Box title={`${proxy.name}\n${proxy.now ?? ''}`} sx={{ overflow: 'hidden' }}>
        <Typography
          variant="body2"
          component="div"
          color="text.primary"
          sx={{
            display: 'block',
            textOverflow: 'ellipsis',
            wordBreak: 'break-all',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
          }}
        >
          {proxy.name}
        </Typography>

        {showType && proxy.now && (
          <Box sx={{ display: 'flex', flexWrap: 'nowrap', flex: 'none', marginTop: '4px' }}>
            <Typography
              variant="body2"
              component="div"
              color="text.secondary"
              sx={{
                display: 'block',
                textOverflow: 'ellipsis',
                wordBreak: 'break-all',
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                marginRight: '8px',
              }}
            >
              {proxy.now}
            </Typography>
          </Box>
        )}
      </Box>

      <Box sx={{ ml: 0.5, color: 'primary.main', display: isPreset ? 'none' : '' }}>
        {delayValue === -2 && (
          <Widget>
            <BaseLoading />
          </Widget>
        )}

        {!proxy.provider && delayValue !== -2 && (
          <Widget
            className="the-check"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onDelay()
            }}
            sx={({ palette }) => ({
              display: 'none',
              ':hover': { bgcolor: alpha(palette.primary.main, 0.15) },
            })}
          >
            Check
          </Widget>
        )}

        {delayValue >= 0 && (
          <Widget
            className="the-delay"
            onClick={(e) => {
              if (proxy.provider) return
              e.preventDefault()
              e.stopPropagation()
              onDelay()
            }}
            color={delayManager.formatDelayColor(delayValue, timeout)}
            sx={({ palette }) =>
              !proxy.provider
                ? { ':hover': { bgcolor: alpha(palette.primary.main, 0.15) } }
                : {}
            }
          >
            {delayManager.formatDelay(delayValue, timeout)}
          </Widget>
        )}

        {proxy.type !== 'Direct' && delayValue !== -2 && delayValue < 0 && selected && (
          <CheckCircleOutlineRounded className="the-icon" sx={{ fontSize: 16, mr: 0.5 }} />
        )}
      </Box>

      {group.fixed && group.fixed === proxy.name && (
        <span
          className={proxy.name === group.now ? 'the-pin' : 'the-unpin'}
          title={group.type === 'URLTest' ? t('proxies.page.labels.delayCheckReset') : ''}
        >
          <TypeBox>PIN</TypeBox>
        </span>
      )}
    </ListItemButton>
  )
}
