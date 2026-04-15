import {
  Alert,
  Box,
  Button,
  CircularProgress,
  IconButton,
  InputAdornment,
  Stack,
  ThemeProvider,
  TextField,
  Typography,
  createTheme,
} from '@mui/material'
import { useLockFn } from 'ahooks'
import { useEffect, useMemo, useState } from 'react'
import {
  LogoutRounded,
  SupportAgentRounded,
  VisibilityOffRounded,
  VisibilityRounded,
  WorkspacePremiumRounded,
} from '@mui/icons-material'

import brandLogo from '@/assets/image/bluelayer-logo.png'
import {
  bootstrapBluelayer,
  canUseBluelayer,
  loginBluelayer,
  logoutBluelayer,
  openForgotPasswordPage,
  openPurchasePage,
  openSupportPage,
  refreshBluelayerSubscription,
  useBluelayerState,
} from '@/services/bluelayer'
import { useThemeMode } from '@/services/states'

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

const gateBackground = (isLight: boolean, backgroundImage?: string) => ({
  width: '100vw',
  height: '100vh',
  display: 'grid',
  placeItems: 'center',
  p: 3,
  overflow: 'hidden',
  position: 'relative',
  backgroundImage: backgroundImage
    ? isLight
      ? `linear-gradient(rgba(255, 248, 238, 0.86), rgba(255, 244, 223, 0.92)), url(${backgroundImage})`
      : `linear-gradient(rgba(8, 8, 10, 0.8), rgba(8, 8, 10, 0.92)), url(${backgroundImage})`
    : isLight
      ? 'radial-gradient(circle at top, rgba(255,159,28,0.2), transparent 26%), radial-gradient(circle at bottom right, rgba(255,214,102,0.12), transparent 24%), linear-gradient(135deg, #f7f1e7, #fff8ef)'
      : 'radial-gradient(circle at top, rgba(255,159,28,0.18), transparent 26%), radial-gradient(circle at bottom right, rgba(255,214,102,0.09), transparent 24%), linear-gradient(135deg, #09090b, #121216)',
  backgroundSize: 'cover',
  backgroundPosition: 'center',
})

export const BluelayerGate = () => {
  const bluelayer = useBluelayerState()
  const themeMode = useThemeMode()
  const isLight = themeMode === 'light'
  const gateTheme = useMemo(
    () => createTheme({ palette: { mode: isLight ? 'light' : 'dark' } }),
    [isLight],
  )
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  useEffect(() => {
    void bootstrapBluelayer()
  }, [])

  const userInfo = bluelayer.session?.userInfo
  const hasPackage = useMemo(
    () => canUseBluelayer(bluelayer.session),
    [bluelayer.session],
  )

  const onLogin = useLockFn(async () => {
    setError('')
    try {
      await loginBluelayer(username.trim(), password)
      await refreshBluelayerSubscription()
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : '登录失败，请稍后重试。',
      )
    }
  })

  const onLogout = useLockFn(async () => {
    await logoutBluelayer()
    setPassword('')
  })

  if (!bluelayer.ready || bluelayer.checking) {
    return (
      <ThemeProvider theme={gateTheme}>
        <Box sx={gateBackground(isLight, bluelayer.loginUi?.bgImg)}>
          <Box
          sx={{
            width: 'min(420px, calc(100vw - 48px))',
            px: 4,
            py: 5,
            borderRadius: '32px',
            background: isLight
              ? 'rgba(255, 250, 242, 0.94)'
              : 'rgba(18, 18, 22, 0.9)',
            border: isLight
              ? '1px solid rgba(31,24,16,0.08)'
              : '1px solid rgba(255,255,255,0.08)',
            boxShadow: isLight
              ? '0 32px 80px rgba(20,16,10,0.16)'
              : '0 32px 80px rgba(0,0,0,0.45)',
            textAlign: 'center',
          }}
        >
          <Box
            sx={{
              width: 176,
              height: 176,
              mx: 'auto',
              mb: 2.5,
              borderRadius: '50%',
              display: 'grid',
              placeItems: 'center',
              background:
                'radial-gradient(circle, rgba(255,185,79,0.5), transparent 62%), rgba(255,159,28,0.08)',
              boxShadow:
                'inset 0 1px 0 rgba(255,255,255,0.08), 0 20px 60px rgba(255,159,28,0.18)',
            }}
          >
            <Box
              component="img"
              src={brandLogo}
              alt="Bluelayer"
              sx={{ width: 132, height: 132, objectFit: 'contain' }}
            />
          </Box>
          <Typography
            variant="h2"
            sx={{ fontWeight: 900, letterSpacing: '0.08em', fontSize: 42 }}
          >
            BLUELAYER
          </Typography>
          <CircularProgress
            size={28}
            sx={{ my: 3.5, color: 'primary.main' }}
            thickness={4.2}
          />
          <Typography sx={{ color: 'text.secondary' }}>
            桌面客户端正在加载，请稍候...
          </Typography>
          </Box>
        </Box>
      </ThemeProvider>
    )
  }

  if (bluelayer.authenticated && !hasPackage) {
    const total = userInfo?.traffic?.total || 0
    const used = userInfo?.traffic?.used || 0

    return (
      <ThemeProvider theme={gateTheme}>
        <Box sx={gateBackground(isLight, bluelayer.loginUi?.bgImg)}>
          <Box
          sx={{
            width: 'min(920px, calc(100vw - 48px))',
            borderRadius: '32px',
            overflow: 'hidden',
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: '1.1fr 0.9fr' },
            background: isLight
              ? 'rgba(255, 250, 242, 0.94)'
              : 'rgba(15, 15, 18, 0.94)',
            border: isLight
              ? '1px solid rgba(31,24,16,0.08)'
              : '1px solid rgba(255,255,255,0.08)',
            boxShadow: isLight
              ? '0 36px 90px rgba(20,16,10,0.16)'
              : '0 36px 90px rgba(0,0,0,0.46)',
          }}
        >
          <Box sx={{ p: { xs: 4, md: 5 } }}>
            <Stack spacing={2.2}>
              <Typography variant="h3" sx={{ fontSize: 36, fontWeight: 800 }}>
                需要有效套餐
              </Typography>
              <Typography sx={{ color: 'text.secondary', maxWidth: 460 }}>
                当前账号已登录，但暂时没有可用的桌面套餐。完成续费或购买后，
                客户端才会继续提供完整的加速与分流能力。
              </Typography>

              <Box
                sx={{
                  mt: 1,
                  p: 2.2,
                  borderRadius: 3,
                  background: isLight
                    ? 'rgba(255,255,255,0.72)'
                    : 'rgba(255,255,255,0.04)',
                  border: isLight
                    ? '1px solid rgba(31,24,16,0.06)'
                    : '1px solid rgba(255,255,255,0.08)',
                }}
              >
                <Stack spacing={1}>
                  <Typography sx={{ fontWeight: 700 }}>
                    {userInfo?.true_name || userInfo?.username || '-'}
                  </Typography>
                  <Typography sx={{ color: 'text.secondary' }}>
                    {`套餐等级：${userInfo?.class ?? 0}`}
                  </Typography>
                  <Typography sx={{ color: 'text.secondary' }}>
                    {`到期时间：${userInfo?.class_expire || '暂无'}`}
                  </Typography>
                </Stack>
              </Box>

              <Stack direction="row" spacing={1.2} flexWrap="wrap" useFlexGap>
                <Button
                  variant="contained"
                  size="large"
                  startIcon={<WorkspacePremiumRounded />}
                  onClick={() => void openPurchasePage()}
                  sx={{ borderRadius: 999, px: 3 }}
                >
                  升级或续费
                </Button>
                <Button
                  variant="outlined"
                  size="large"
                  startIcon={<SupportAgentRounded />}
                  onClick={() => void openSupportPage()}
                  sx={{ borderRadius: 999, px: 3 }}
                >
                  联系客服
                </Button>
                <Button
                  color="inherit"
                  size="large"
                  startIcon={<LogoutRounded />}
                  onClick={() => void onLogout()}
                  sx={{ borderRadius: 999, px: 3 }}
                >
                  退出登录
                </Button>
              </Stack>
            </Stack>
          </Box>

          <Box
            sx={{
              position: 'relative',
              p: { xs: 4, md: 5 },
              background: isLight
                ? 'radial-gradient(circle at center, rgba(255,159,28,0.18), transparent 40%), linear-gradient(180deg, rgba(255,255,255,0.82), rgba(255,244,223,0.7))'
                : 'radial-gradient(circle at center, rgba(255,159,28,0.18), transparent 40%), linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))',
              borderLeft: {
                xs: 'none',
                md: isLight
                  ? '1px solid rgba(31,24,16,0.08)'
                  : '1px solid rgba(255,255,255,0.08)',
              },
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              textAlign: 'center',
            }}
          >
            <Box
              component="img"
              src={brandLogo}
              alt="Bluelayer"
              sx={{ width: 220, maxWidth: '100%', mb: 3 }}
            />
            <Stack direction="row" spacing={4}>
              <Box>
                <Typography sx={{ color: 'text.secondary', mb: 0.5 }}>
                  总流量
                </Typography>
                <Typography sx={{ fontWeight: 800, fontSize: 20 }}>
                  {formatTraffic(total)}
                </Typography>
              </Box>
              <Box>
                <Typography sx={{ color: 'text.secondary', mb: 0.5 }}>
                  已用流量
                </Typography>
                <Typography sx={{ fontWeight: 800, fontSize: 20 }}>
                  {formatTraffic(used)}
                </Typography>
              </Box>
            </Stack>
          </Box>
          </Box>
        </Box>
      </ThemeProvider>
    )
  }

  if (bluelayer.authenticated) return null

  return (
    <ThemeProvider theme={gateTheme}>
      <Box sx={gateBackground(isLight, bluelayer.loginUi?.bgImg)}>
        <Box
        sx={{
          position: 'absolute',
          inset: 0,
          background: isLight
            ? 'radial-gradient(circle at 15% 10%, rgba(255,159,28,0.16), transparent 20%), radial-gradient(circle at 85% 85%, rgba(255,214,102,0.12), transparent 18%)'
            : 'radial-gradient(circle at 15% 10%, rgba(255,159,28,0.18), transparent 20%), radial-gradient(circle at 85% 85%, rgba(255,214,102,0.08), transparent 18%)',
          filter: 'blur(8px)',
        }}
      />

        <Box
        sx={{
          position: 'relative',
          width: 'min(980px, calc(100vw - 48px))',
          borderRadius: '32px',
          overflow: 'hidden',
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '0.95fr 1fr' },
          background: isLight
            ? 'rgba(255, 250, 242, 0.95)'
            : 'rgba(12, 12, 15, 0.94)',
          border: isLight
            ? '1px solid rgba(31,24,16,0.08)'
            : '1px solid rgba(255,255,255,0.08)',
          boxShadow: isLight
            ? '0 36px 90px rgba(20,16,10,0.16)'
            : '0 36px 90px rgba(0,0,0,0.5)',
          minHeight: { xs: 'auto', md: 560 },
        }}
      >
        <Box
          component="form"
          onSubmit={(event) => {
            event.preventDefault()
            void onLogin()
          }}
          sx={{
            p: { xs: 4, md: 5 },
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
          }}
        >
          <Stack spacing={2.5}>
            <Box textAlign={{ xs: 'center', md: 'left' }}>
              <Typography variant="h3" sx={{ fontWeight: 800, fontSize: 42 }}>
                登录
              </Typography>
              <Typography sx={{ color: 'text.secondary', mt: 1 }}>
                {bluelayer.loginUi?.bgDesc ||
                  '请登录你的桌面账户。'}
              </Typography>
            </Box>

            <TextField
              placeholder="邮箱账号"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              fullWidth
              variant="outlined"
              slotProps={{
                input: {
                  sx: {
                    borderRadius: 999,
                    backgroundColor: isLight
                      ? 'rgba(255,255,255,0.88)'
                      : 'rgba(255,255,255,0.06)',
                  },
                },
              }}
            />

            <TextField
              placeholder="登录密码"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              fullWidth
              variant="outlined"
              slotProps={{
                input: {
                  sx: {
                    borderRadius: 999,
                    backgroundColor: isLight
                      ? 'rgba(255,255,255,0.88)'
                      : 'rgba(255,255,255,0.06)',
                  },
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        edge="end"
                        onClick={() => setShowPassword((value) => !value)}
                      >
                        {showPassword ? (
                          <VisibilityRounded />
                        ) : (
                          <VisibilityOffRounded />
                        )}
                      </IconButton>
                    </InputAdornment>
                  ),
                },
              }}
            />

            {error ? (
              <Alert severity="error" sx={{ borderRadius: 3 }}>
                {error}
              </Alert>
            ) : null}

            <Button
              type="submit"
              variant="contained"
              size="large"
              disabled={!username.trim() || !password}
              sx={{ borderRadius: 999, py: 1.5, fontWeight: 800, fontSize: 18 }}
            >
              登录
            </Button>

            <Stack spacing={1} alignItems={{ xs: 'center', md: 'flex-start' }}>
              <Button
                variant="text"
                onClick={() => void openForgotPasswordPage()}
                sx={{ color: 'primary.main', fontWeight: 700 }}
              >
                忘记密码
              </Button>
              <Stack direction="row" spacing={1.2} flexWrap="wrap" useFlexGap>
                <Button
                  variant="outlined"
                  onClick={() => void openPurchasePage()}
                  sx={{ borderRadius: 999 }}
                >
                  购买套餐
                </Button>
                <Button
                  variant="text"
                  onClick={() => void openSupportPage()}
                  sx={{ borderRadius: 999 }}
                >
                  联系客服
                </Button>
              </Stack>
            </Stack>
          </Stack>
        </Box>

        <Box
          sx={{
            position: 'relative',
            p: { xs: 4, md: 5 },
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: isLight
              ? 'linear-gradient(180deg, rgba(255,255,255,0.82), rgba(255,244,223,0.7))'
              : 'linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))',
            borderLeft: {
              xs: 'none',
              md: isLight
                ? '1px solid rgba(31,24,16,0.08)'
                : '1px solid rgba(255,255,255,0.08)',
            },
          }}
        >
          <Box
            sx={{
              width: '100%',
              maxWidth: 420,
              aspectRatio: '1 / 1.2',
              borderRadius: 5,
              border: isLight
                ? '1px solid rgba(31,24,16,0.08)'
                : '1px solid rgba(255,255,255,0.08)',
              background: isLight
                ? 'radial-gradient(circle at center, rgba(255,159,28,0.16), transparent 34%), linear-gradient(180deg, rgba(255,255,255,0.88), rgba(255,244,223,0.76))'
                : 'radial-gradient(circle at center, rgba(255,159,28,0.16), transparent 34%), linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.03))',
              display: 'grid',
              placeItems: 'center',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <Box
              sx={{
                position: 'absolute',
                inset: 18,
                borderRadius: 5,
                border: '1px solid rgba(255,255,255,0.04)',
              }}
            />
            <Box
              component="img"
              src={brandLogo}
              alt="Bluelayer"
              sx={{
                width: '70%',
                maxWidth: 260,
                position: 'relative',
                zIndex: 1,
              }}
            />
          </Box>
        </Box>
        </Box>
      </Box>
    </ThemeProvider>
  )
}

