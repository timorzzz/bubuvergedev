import {
  LogoutRounded,
  ShoppingCartRounded,
  SupportAgentRounded,
  WorkspacePremiumRounded,
} from '@mui/icons-material'
import {
  Box,
  Button,
  CircularProgress,
  Chip,
  Grid,
  Stack,
  Typography,
  alpha,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { useState } from 'react'

import { BasePage } from '@/components/base'
import {
  logoutBluelayer,
  openPurchasePage,
  openSupportPage,
  useBluelayerState,
} from '@/services/bluelayer'

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

const AccountPage = () => {
  const theme = useTheme()
  const isLight = theme.palette.mode === 'light'
  const { session } = useBluelayerState()
  const [openingPanelKey, setOpeningPanelKey] = useState<
    'renew' | 'shop' | 'support' | null
  >(null)

  const user = session?.userInfo
  const totalTraffic = user?.traffic?.total || 0
  const usedTraffic = user?.traffic?.used || 0
  const remainingTraffic = Math.max(totalTraffic - usedTraffic, 0)

  const surfaceStyle = {
    background: isLight ? 'rgba(255, 250, 242, 0.9)' : 'rgba(255,255,255,0.04)',
    border: isLight
      ? '1px solid rgba(31,24,16,0.08)'
      : '1px solid rgba(255,255,255,0.08)',
    boxShadow: isLight
      ? '0 24px 60px rgba(20,16,10,0.08)'
      : '0 24px 60px rgba(0,0,0,0.18)',
  } as const

  const runPanelAction = async (
    key: 'renew' | 'shop' | 'support',
    action: () => Promise<void>,
  ) => {
    setOpeningPanelKey(key)
    try {
      await action()
    } finally {
      setOpeningPanelKey(null)
    }
  }

  return (
    <BasePage
      title="账户"
      header={<Box />}
      full
      contentStyle={{ height: '100%', minHeight: 0 }}
    >
      <Grid
        container
        spacing={2}
        columns={{ xs: 12 }}
        sx={{ height: '100%', minHeight: 0 }}
      >
        <Grid size={{ xs: 12, md: 7 }}>
          <Box
            sx={{
              height: '100%',
              borderRadius: 5,
              p: 2.2,
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              ...surfaceStyle,
            }}
          >
            <Stack spacing={1}>
              <Typography sx={{ fontSize: 28, fontWeight: 900 }}>
                账户与套餐
              </Typography>
            </Stack>

            <Box
              sx={{
                borderRadius: 4,
                p: 2,
                background: isLight
                  ? 'rgba(255,255,255,0.72)'
                  : 'rgba(255,255,255,0.05)',
                border: isLight
                  ? '1px solid rgba(31,24,16,0.05)'
                  : '1px solid rgba(255,255,255,0.06)',
              }}
            >
              <Typography sx={{ color: 'text.secondary', fontSize: 13 }}>
                当前账号
              </Typography>
              <Typography sx={{ mt: 0.5, fontSize: 24, fontWeight: 800 }}>
                {user?.true_name || user?.username || '-'}
              </Typography>
              <Stack
                direction="row"
                spacing={1}
                flexWrap="wrap"
                useFlexGap
                sx={{ mt: 1.5 }}
              >
                <Chip
                  label={`套餐等级 Lv.${user?.class ?? 0}`}
                  sx={{ borderRadius: 999, fontWeight: 700 }}
                />
                <Chip
                  label={`到期时间 ${user?.class_expire || '未知'}`}
                  sx={{ borderRadius: 999 }}
                />
              </Stack>
            </Box>

            <Grid container spacing={2} columns={{ xs: 12 }}>
              <Grid size={{ xs: 12, sm: 4 }}>
                <Box
                  sx={{
                    height: '100%',
                    borderRadius: 4,
                    p: 2,
                    background: alpha('#ff9f1c', 0.1),
                  }}
                >
                  <Typography sx={{ color: 'text.secondary', fontSize: 13 }}>
                    总流量
                  </Typography>
                  <Typography sx={{ mt: 0.6, fontSize: 15, fontWeight: 800 }}>
                    {formatTraffic(totalTraffic)}
                  </Typography>
                </Box>
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <Box
                  sx={{
                    height: '100%',
                    borderRadius: 4,
                    p: 2,
                    background: alpha(theme.palette.primary.main, 0.12),
                  }}
                >
                  <Typography sx={{ color: 'text.secondary', fontSize: 13 }}>
                    已用流量
                  </Typography>
                  <Typography sx={{ mt: 0.6, fontSize: 15, fontWeight: 800 }}>
                    {formatTraffic(usedTraffic)}
                  </Typography>
                </Box>
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <Box
                  sx={{
                    height: '100%',
                    borderRadius: 4,
                    p: 2,
                    background: alpha('#34c759', 0.12),
                  }}
                >
                  <Typography sx={{ color: 'text.secondary', fontSize: 13 }}>
                    剩余流量
                  </Typography>
                  <Typography sx={{ mt: 0.6, fontSize: 15, fontWeight: 800 }}>
                    {formatTraffic(remainingTraffic)}
                  </Typography>
                </Box>
              </Grid>
            </Grid>
          </Box>
        </Grid>

        <Grid size={{ xs: 12, md: 5 }}>
          <Stack spacing={2} sx={{ height: '100%' }}>
            <Box
              sx={{
                borderRadius: 5,
                p: 2.2,
                ...surfaceStyle,
              }}
            >
              <Stack spacing={1.4}>
                <Typography sx={{ fontSize: 24, fontWeight: 800 }}>
                  套餐服务
                </Typography>
                <Typography sx={{ color: 'text.secondary' }}>
                  需要升级套餐、续费或联系人工支持时，都可以直接在这里处理。
                </Typography>
                {openingPanelKey ? (
                  <Box
                    sx={{
                      borderRadius: 3,
                      px: 1.4,
                      py: 1.1,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1,
                      background: isLight
                        ? 'rgba(255,255,255,0.8)'
                        : 'rgba(255,255,255,0.06)',
                      border: isLight
                        ? '1px solid rgba(31,24,16,0.06)'
                        : '1px solid rgba(255,255,255,0.08)',
                    }}
                  >
                    <CircularProgress size={18} />
                    <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
                      正在打开面板并确认当前账户登录状态，请稍候...
                    </Typography>
                  </Box>
                ) : null}
                <Button
                  variant="contained"
                  startIcon={<WorkspacePremiumRounded />}
                  onClick={() => void runPanelAction('renew', openPurchasePage)}
                  disabled={Boolean(openingPanelKey)}
                  sx={{ borderRadius: 999, py: 1.2, fontWeight: 800 }}
                >
                  升级或续费
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<ShoppingCartRounded />}
                  onClick={() => void runPanelAction('shop', openPurchasePage)}
                  disabled={Boolean(openingPanelKey)}
                  sx={{ borderRadius: 999, py: 1.2, fontWeight: 700 }}
                >
                  打开购买页面
                </Button>
                <Button
                  variant="text"
                  startIcon={<SupportAgentRounded />}
                  onClick={() => void runPanelAction('support', openSupportPage)}
                  disabled={Boolean(openingPanelKey)}
                  sx={{ borderRadius: 999, py: 1.2, fontWeight: 700 }}
                >
                  联系客服
                </Button>
                <Button
                  variant="text"
                  color="inherit"
                  startIcon={<LogoutRounded />}
                  onClick={() => void logoutBluelayer()}
                  disabled={Boolean(openingPanelKey)}
                  sx={{ borderRadius: 999, py: 1.2, fontWeight: 700 }}
                >
                  退出登录
                </Button>
              </Stack>
            </Box>
          </Stack>
        </Grid>
      </Grid>
    </BasePage>
  )
}

export default AccountPage
