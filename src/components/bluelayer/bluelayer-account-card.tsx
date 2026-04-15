import { CreditCardRounded, LogoutRounded, SupportAgentRounded } from '@mui/icons-material'
import { Box, Button, Chip, Stack, Typography } from '@mui/material'

import { EnhancedCard } from '@/components/home/enhanced-card'
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

export const BluelayerAccountCard = () => {
  const { session } = useBluelayerState()
  const user = session?.userInfo
  const total = user?.traffic?.total || 0
  const used = user?.traffic?.used || 0
  const remain = Math.max(total - used, 0)

  return (
    <EnhancedCard
      title="Bluelayer 账户"
      icon={<CreditCardRounded />}
      iconColor="primary"
      action={null}
    >
      <Stack spacing={1.5}>
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Box>
            <Typography fontWeight={700}>{user?.true_name || user?.username || '-'}</Typography>
            <Typography variant="body2" color="text.secondary">
              套餐等级：{user?.class ?? 0} · 到期：{user?.class_expire || '未设置'}
            </Typography>
          </Box>
          <Chip label={`余额 ${user?.balance ?? 0}`} color="primary" variant="outlined" />
        </Box>

        <Box display="grid" gridTemplateColumns="repeat(3, minmax(0, 1fr))" gap={1}>
          <Box>
            <Typography variant="caption" color="text.secondary">总流量</Typography>
            <Typography fontWeight={700}>{formatTraffic(total)}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">已使用</Typography>
            <Typography fontWeight={700}>{formatTraffic(used)}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">剩余</Typography>
            <Typography fontWeight={700}>{formatTraffic(remain)}</Typography>
          </Box>
        </Box>

        <Stack direction="row" spacing={1} flexWrap="wrap">
          <Button size="small" variant="contained" onClick={() => void openPurchasePage()}>
            续费/购买
          </Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<SupportAgentRounded />}
            onClick={() => void openSupportPage()}
          >
            联系客服
          </Button>
          <Button
            size="small"
            color="inherit"
            startIcon={<LogoutRounded />}
            onClick={() => void logoutBluelayer()}
          >
            退出登录
          </Button>
        </Stack>
      </Stack>
    </EnhancedCard>
  )
}
