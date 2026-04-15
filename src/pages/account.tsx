import type { ReactNode } from 'react'

import {
  AccountBalanceWalletRounded,
  ArticleRounded,
  PowerSettingsNewRounded,
  SecurityRounded,
  SettingsEthernetRounded,
  WifiRounded,
} from '@mui/icons-material'
import { CircularProgress, alpha, Box, Grid, Stack, Switch, Typography } from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { useState } from 'react'
import { useNavigate } from 'react-router'

import brandLogo from '@/assets/image/bluelayer-logo.png'
import { BasePage } from '@/components/base'
import { useVerge } from '@/hooks/use-verge'
import { useAppData } from '@/providers/app-data-context'
import { logoutBluelayer, useBluelayerState } from '@/services/bluelayer'

const formatCurrency = (value?: string | number | null) => {
  const normalized =
    typeof value === 'number' ? value : Number(value == null || value === '' ? 0 : value)
  return `\u00A5 ${Number.isFinite(normalized) ? normalized.toFixed(2) : '0.00'}`
}

const AccountPage = () => {
  const theme = useTheme()
  const navigate = useNavigate()
  const { session } = useBluelayerState()
  const { clashConfig } = useAppData()
  const { verge, patchVerge } = useVerge()
  const [loggingOut, setLoggingOut] = useState(false)

  const user = session?.userInfo
  const packageLevel = user?.class ? `VIP${user.class}\u4f1a\u5458` : '\u672a\u5f00\u901a\u5957\u9910'
  const expiryText = user?.class_expire || '\u672a\u8bbe\u7f6e'
  const balanceText = formatCurrency(user?.balance)
  const autoLaunchEnabled = Boolean(verge?.enable_auto_launch)
  const keepProxyEnabled = Boolean(verge?.enable_proxy_guard)
  const httpPortText = verge?.verge_port
    ? String(verge.verge_port)
    : clashConfig?.port
      ? String(clashConfig.port)
      : '\u4e0d\u53ef\u7528'
  const socksPortText = verge?.verge_socks_port
    ? String(verge.verge_socks_port)
    : clashConfig?.socksPort
      ? String(clashConfig.socksPort)
      : '\u4e0d\u53ef\u7528'

  const tileStyle = (lastColumn = false, secondRow = false) =>
    ({
      height: '100%',
      minHeight: 102,
      px: 2.05,
      py: 1.45,
      background: '#ffffff',
      borderRight: lastColumn ? 'none' : '1px solid rgba(19, 31, 53, 0.08)',
      borderTop: secondRow ? '1px solid rgba(19, 31, 53, 0.08)' : 'none',
    }) as const

  const renderIconBubble = (icon: ReactNode) => (
    <Box
      sx={{
        width: 34,
        height: 34,
        borderRadius: '50%',
        display: 'grid',
        placeItems: 'center',
        background: '#f3f8ff',
        flexShrink: 0,
        position: 'relative',
        '&::before': {
          content: '""',
          position: 'absolute',
          width: 15,
          height: 15,
          borderRadius: 2,
          border: '2px solid #7db7ff',
          transform: 'rotate(45deg)',
        },
      }}
    >
      <Box
        sx={{
          position: 'relative',
          zIndex: 1,
          color: '#ff8f75',
          display: 'grid',
          placeItems: 'center',
        }}
      >
        {icon}
      </Box>
    </Box>
  )

  const switchSx = {
    mr: 0.1,
    '& .MuiSwitch-switchBase.Mui-checked': { color: '#ffffff' },
    '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
      backgroundColor: '#b7bdc6',
      opacity: 1,
    },
    '& .MuiSwitch-track': { backgroundColor: '#c8cdd5', opacity: 1 },
  } as const

  const handleLogout = async () => {
    if (loggingOut) return
    setLoggingOut(true)
    try {
      await logoutBluelayer()
    } finally {
      setLoggingOut(false)
    }
  }

  return (
    <BasePage title={'\u4e2a\u4eba\u4e2d\u5fc3'} header={<Box />} full contentStyle={{ height: '100%' }}>
      <Box
        sx={{
          height: 'calc(100% - 12px)',
          overflow: 'hidden',
          background: '#ffffff',
          border: '1px solid rgba(19, 31, 53, 0.08)',
          display: 'flex',
          flexDirection: 'column',
          alignSelf: 'stretch',
        }}
      >
        <Box
          sx={{
            px: 3,
            py: 1.7,
            flex: '0 0 248px',
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
          }}
        >
          <Box
            onClick={() => void handleLogout()}
            sx={{
              position: 'absolute',
              top: 16,
              right: 22,
              color: '#ff5c3a',
              fontSize: 14,
              cursor: loggingOut ? 'default' : 'pointer',
              userSelect: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: 0.8,
              opacity: loggingOut ? 0.72 : 1,
            }}
          >
            {loggingOut && <CircularProgress size={14} sx={{ color: '#ff5c3a' }} />}
            <Typography sx={{ fontSize: 14, color: 'inherit' }}>
              {loggingOut ? '\u6b63\u5728\u9000\u51fa...' : '\u9000\u51fa\u767b\u5f55'}
            </Typography>
          </Box>

          <Box
            sx={{
              width: 86,
              height: 86,
              borderRadius: '50%',
              display: 'grid',
              placeItems: 'center',
              background:
                'radial-gradient(circle at 35% 30%, #a8d7ff, #73bbff 58%, #5b99ff 100%)',
            }}
          >
            <Box component="img" src={brandLogo} alt="Bluelayer" sx={{ width: 54, height: 54 }} />
          </Box>

          <Typography sx={{ mt: 2.1, fontSize: 18, fontWeight: 500, color: '#1d2433' }}>
            {user?.true_name || user?.username || '-'}
          </Typography>
          <Typography sx={{ mt: 0.7, fontSize: 15, color: '#8f98a8' }}>{packageLevel}</Typography>
          <Typography sx={{ mt: 0.35, fontSize: 14, color: '#8f98a8' }}>{expiryText}</Typography>
        </Box>

        <Grid
          container
          columns={12}
          sx={{
            borderTop: '1px solid rgba(19, 31, 53, 0.08)',
            flex: 1,
            minHeight: 0,
            gridAutoRows: '1fr',
          }}
        >
          <Grid size={4}>
            <Box sx={tileStyle(false, false)}>
              <Stack direction="row" alignItems="center" spacing={1.1}>
                {renderIconBubble(<WifiRounded sx={{ fontSize: 16 }} />)}
                <Typography sx={{ fontSize: 15, color: '#1f2c44', fontWeight: 500 }}>
                  {'http(s)\u7aef\u53e3'}
                </Typography>
              </Stack>
              <Typography sx={{ mt: 2.1, pl: 5.15, fontSize: 15, fontWeight: 500, color: '#6f7685' }}>
                {httpPortText}
              </Typography>
            </Box>
          </Grid>

          <Grid size={4}>
            <Box sx={tileStyle(false, false)}>
              <Stack direction="row" alignItems="center" spacing={1.1}>
                {renderIconBubble(<SettingsEthernetRounded sx={{ fontSize: 16 }} />)}
                <Typography sx={{ fontSize: 15, color: '#1f2c44', fontWeight: 500 }}>
                  {'socks\u7aef\u53e3'}
                </Typography>
              </Stack>
              <Typography sx={{ mt: 2.1, pl: 5.15, fontSize: 15, fontWeight: 500, color: '#6f7685' }}>
                {socksPortText}
              </Typography>
            </Box>
          </Grid>

          <Grid size={4}>
            <Box sx={tileStyle(true, false)}>
              <Stack direction="row" alignItems="center" spacing={1.1}>
                {renderIconBubble(<AccountBalanceWalletRounded sx={{ fontSize: 16 }} />)}
                <Typography sx={{ fontSize: 15, color: '#1f2c44', fontWeight: 500 }}>
                  {'\u8d26\u6237\u4f59\u989d'}
                </Typography>
              </Stack>
              <Typography sx={{ mt: 2.1, pl: 5.15, fontSize: 15, fontWeight: 500, color: '#6f7685' }}>
                {balanceText}
              </Typography>
            </Box>
          </Grid>

          <Grid size={4}>
            <Box sx={tileStyle(false, true)}>
              <Stack direction="row" alignItems="center" spacing={1.1}>
                {renderIconBubble(<PowerSettingsNewRounded sx={{ fontSize: 16 }} />)}
                <Typography sx={{ fontSize: 15, color: '#1f2c44', fontWeight: 500 }}>
                  {'\u5f00\u673a\u81ea\u542f'}
                </Typography>
              </Stack>
              <Box sx={{ mt: 2.05, pl: 4.1, display: 'flex', alignItems: 'center', gap: 0.2 }}>
                <Switch
                  size="small"
                  checked={autoLaunchEnabled}
                  onChange={() => void patchVerge({ enable_auto_launch: !autoLaunchEnabled })}
                  sx={switchSx}
                />
                <Typography sx={{ fontSize: 15, color: '#7a8291' }}>
                  {autoLaunchEnabled ? '\u5f00' : '\u5173'}
                </Typography>
              </Box>
            </Box>
          </Grid>

          <Grid size={4}>
            <Box
              sx={{
                ...tileStyle(false, true),
                cursor: 'pointer',
                '&:hover': { background: alpha(theme.palette.primary.main, 0.03) },
              }}
              onClick={() => navigate('/logs')}
            >
              <Stack direction="row" alignItems="center" spacing={1.1}>
                {renderIconBubble(<ArticleRounded sx={{ fontSize: 16 }} />)}
                <Typography sx={{ fontSize: 15, color: '#1f2c44', fontWeight: 500 }}>
                  {'Log\u67e5\u770b'}
                </Typography>
              </Stack>
              <Typography
                sx={{
                  mt: 2.1,
                  pl: 5.15,
                  fontSize: 15,
                  fontWeight: 500,
                  color: theme.palette.primary.main,
                }}
              >
                {'\u70b9\u51fb\u67e5\u770b'}
              </Typography>
            </Box>
          </Grid>

          <Grid size={4}>
            <Box sx={tileStyle(true, true)}>
              <Stack direction="row" alignItems="center" spacing={1.1}>
                {renderIconBubble(<SecurityRounded sx={{ fontSize: 16 }} />)}
                <Typography sx={{ fontSize: 15, color: '#1f2c44', fontWeight: 500 }}>
                  {'\u4fdd\u6301\u4ee3\u7406'}
                </Typography>
              </Stack>
              <Box sx={{ mt: 2.05, pl: 4.1, display: 'flex', alignItems: 'center', gap: 0.2 }}>
                <Switch
                  size="small"
                  checked={keepProxyEnabled}
                  onChange={() => void patchVerge({ enable_proxy_guard: !keepProxyEnabled })}
                  sx={switchSx}
                />
                <Typography sx={{ fontSize: 15, color: '#7a8291' }}>
                  {keepProxyEnabled ? '\u5f00' : '\u5173'}
                </Typography>
              </Box>
            </Box>
          </Grid>
        </Grid>
      </Box>
    </BasePage>
  )
}

export default AccountPage
