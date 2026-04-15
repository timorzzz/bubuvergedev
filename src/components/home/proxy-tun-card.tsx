import {
  BoltRounded,
  LanRounded,
  ShieldRounded,
  CheckCircleRounded,
} from '@mui/icons-material'
import {
  Box,
  Typography,
  Stack,
  Paper,
  alpha,
  useTheme,
} from '@mui/material'
import { FC, memo, useMemo } from 'react'

import ProxyControlSwitches from '@/components/shared/proxy-control-switches'
import { useSystemProxyState } from '@/hooks/use-system-proxy-state'
import { useSystemState } from '@/hooks/use-system-state'
import { useVerge } from '@/hooks/use-verge'
import { showNotice } from '@/services/notice-service'

export const ProxyTunCard: FC = memo(() => {
  const theme = useTheme()
  const { verge } = useVerge()
  const { isTunModeAvailable } = useSystemState()
  const { indicator: systemProxyIndicator, configState: systemProxyConfigState } = useSystemProxyState()

  const enableTunMode = verge?.enable_tun_mode ?? false
  const isEnabled = enableTunMode || systemProxyConfigState

  const title = useMemo(() => {
    if (enableTunMode) return '已开启代理：虚拟网卡模式'
    if (systemProxyIndicator) return '已开启代理：系统代理模式'
    if (systemProxyConfigState) return '系统代理正在应用中'
  }, [enableTunMode, systemProxyIndicator, systemProxyConfigState])

  const desc = useMemo(() => {
    if (enableTunMode) {
      return isTunModeAvailable
        ? '当前已经可以正常使用代理。虚拟网卡模式兼容性更强，适合系统代理无法生效时使用。'
        : '虚拟网卡模式当前不可用，需要安装服务或使用管理员权限。'
    }
    if (systemProxyIndicator) {
      return '当前已经可以正常使用代理。浏览器和大多数软件会直接走代理，无需再额外设置。'
    }
    if (systemProxyConfigState) {
      return '正在为你接管系统代理，完成后浏览器和大多数软件就可以直接走代理。'
    }
    return '打开下面的开关后就已经开启VPN，一般不需要再做别的设置。'
  }, [enableTunMode, isTunModeAvailable, systemProxyIndicator, systemProxyConfigState])

  const handleError = (err: unknown) => {
    showNotice.error(err)
  }

  return (
    <Paper
      elevation={0}
      sx={{
        p: 1.5,
        borderRadius: 2,
        bgcolor: alpha(theme.palette.primary.main, 0.04),
        border: `1px solid ${alpha(theme.palette.primary.main, 0.12)}`,
      }}
    >
      <Stack spacing={1.2}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.2,
          }}
        >
          <Box
            sx={{
              width: 38,
              height: 38,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: isEnabled
                ? alpha(theme.palette.success.main, 0.14)
                : alpha(theme.palette.text.primary, 0.06),
              color: isEnabled ? 'success.main' : 'text.secondary',
              flexShrink: 0,
            }}
          >
            <BoltRounded />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
              一键开启加速
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
              {title}
            </Typography>
            {!enableTunMode && (
              <Typography
                variant="caption"
                sx={{
                  mt: 0.6,
                  display: 'inline-flex',
                  alignItems: 'center',
                  px: 0.8,
                  py: 0.2,
                  borderRadius: 999,
                  bgcolor: alpha(theme.palette.primary.main, 0.08),
                  color: systemProxyIndicator ? 'success.main' : 'primary.main',
                  fontWeight: 600,
                }}
              >
                {systemProxyIndicator
                  ? '系统代理已打开，代理已开启'
                  : '新手直接打开“VPN代理连接开关”即可'}
              </Typography>
            )}
          </Box>
        </Box>

        <Box
          sx={{
            p: 1.2,
            borderRadius: 1.5,
            bgcolor: 'background.paper',
            border: `1px solid ${alpha(theme.palette.divider, 0.8)}`,
          }}
        >
          <Stack spacing={0.9}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
              {enableTunMode ? (
                <ShieldRounded sx={{ fontSize: 18, color: 'warning.main' }} />
              ) : (
                <LanRounded sx={{ fontSize: 18, color: 'primary.main' }} />
              )}
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {enableTunMode ? '当前为虚拟网卡模式' : systemProxyIndicator ? '系统代理已开启' : '优先使用系统代理模式'}
              </Typography>
            </Box>

            <Typography variant="body2" color="text.secondary">
              {desc}
            </Typography>

            {systemProxyIndicator && !enableTunMode && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
                <CheckCircleRounded sx={{ fontSize: 16, color: 'success.main' }} />
                <Typography variant="caption" color="success.main">
                  系统代理已生效，代理已经开启，可以直接使用。
                </Typography>
              </Box>
            )}
          </Stack>
        </Box>

        <Box sx={{ mt: 0.2 }}>
          <ProxyControlSwitches onError={handleError} noRightPadding={true} />
        </Box>
      </Stack>
    </Paper>
  )
})
