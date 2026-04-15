import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  ThemeProvider,
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

import {
  bootstrapBluelayer,
  canUseBluelayer,
  getRememberedCredentials,
  loginBluelayer,
  logoutBluelayer,
  openForgotPasswordPage,
  openPurchasePage,
  openRegisterPage,
  openSupportPage,
  refreshBluelayerSubscription,
  saveRememberedCredentials,
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

const buildGateTheme = (isLight: boolean) =>
  createTheme({
    palette: {
      mode: isLight ? 'light' : 'dark',
      primary: {
        main: '#2688ea',
      },
    },
    typography: {
      fontFamily:
        '"Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
    },
  })

const rootStyle = (isLight: boolean) => ({
  width: '100%',
  height: '100%',
  overflow: 'hidden',
  display: 'block',
  background: isLight ? '#eef2f6' : '#0a1320',
})

const windowStyle = {
  width: '100%',
  height: '100%',
  display: 'grid',
  gridTemplateColumns: '320px 1fr',
  overflow: 'hidden',
  borderRadius: 0,
  background: '#ffffff',
  boxShadow: 'none',
} as const

const sidePanelStyle = (backgroundImage?: string) => ({
  position: 'relative' as const,
  height: '100%',
  padding: '34px 30px',
  color: '#ffffff',
  background: backgroundImage
    ? `linear-gradient(rgba(112, 139, 236, 0.92), rgba(112, 139, 236, 0.96)), url(${backgroundImage}) center/cover`
    : 'linear-gradient(180deg, #7892ee 0%, #7290ee 100%)',
})

const decorationStyle = {
  position: 'absolute' as const,
  borderRadius: '50%',
  background: 'rgba(255,255,255,0.08)',
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const BluelayerGate = () => {
  const bluelayer = useBluelayerState()
  const themeMode = useThemeMode()
  const isLight = themeMode === 'light'
  const gateTheme = useMemo(() => buildGateTheme(isLight), [isLight])
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(true)
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  useEffect(() => {
    void bootstrapBluelayer()
  }, [])

  useEffect(() => {
    void (async () => {
      const remembered = await getRememberedCredentials()
      if (!remembered) {
        setRememberMe(false)
        return
      }
      setUsername(remembered.username)
      setPassword(remembered.password)
      setRememberMe(true)
    })()
  }, [])

  const userInfo = bluelayer.session?.userInfo
  const hasPackage = useMemo(
    () => canUseBluelayer(bluelayer.session),
    [bluelayer.session],
  )
  const usernameHasSpace = /\s/.test(username)
  const usernameTrimmed = username.trim()
  const usernameErrorText = useMemo(() => {
    if (!username) return ''
    if (usernameHasSpace) return '邮箱中不能包含空格，请修改后再登录。'
    if (!EMAIL_PATTERN.test(usernameTrimmed)) return '请输入正确的邮箱格式。'
    return ''
  }, [username, usernameHasSpace, usernameTrimmed])
  const isUsernameValid = !usernameErrorText && !!usernameTrimmed

  const onLogin = useLockFn(async () => {
    setError('')
    if (!isUsernameValid) {
      setError(usernameErrorText || '请输入正确的邮箱地址。')
      return
    }
    try {
      await loginBluelayer(usernameTrimmed, password)
      if (rememberMe) {
        await saveRememberedCredentials({
          username: usernameTrimmed,
          password,
        })
      } else {
        await saveRememberedCredentials(null)
      }
      await refreshBluelayerSubscription()
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败，请稍后重试。')
    }
  })

  const onLogout = useLockFn(async () => {
    await logoutBluelayer()
    setPassword('')
  })

  if (!bluelayer.ready || bluelayer.checking) {
    return (
      <ThemeProvider theme={gateTheme}>
        <Box sx={rootStyle(isLight)}>
          <Box sx={windowStyle}>
            <Box sx={sidePanelStyle(bluelayer.loginUi?.bgImg)}>
              <Box sx={{ ...decorationStyle, width: 118, height: 118, top: 34, right: 28 }} />
              <Box sx={{ ...decorationStyle, width: 138, height: 138, left: 28, bottom: 78 }} />
              <Typography sx={{ fontSize: 18, fontWeight: 700, mb: 1 }}>
                Bluelayer加速器
              </Typography>
              <Typography sx={{ fontSize: 12, opacity: 0.95 }}>
                谦仁网络
              </Typography>
            </Box>

            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                px: 5,
                textAlign: 'center',
              }}
            >
              <CircularProgress size={26} sx={{ color: '#2688ea' }} />
              <Typography
                sx={{
                  mt: 3,
                  fontSize: 28,
                  fontWeight: 700,
                  color: '#273349',
                }}
              >
                正在登录中
              </Typography>
              <Typography
                sx={{
                  mt: 1.2,
                  maxWidth: 320,
                  fontSize: 14,
                  lineHeight: 1.8,
                  color: '#7a8597',
                }}
              >
                正在加载环境中，加载速度取决于你的网络连接质量...
              </Typography>
            </Box>
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
        <Box sx={rootStyle(isLight)}>
          <Box sx={windowStyle}>
            <Box sx={sidePanelStyle(bluelayer.loginUi?.bgImg)}>
              <Box sx={{ ...decorationStyle, width: 118, height: 118, top: 34, right: 28 }} />
              <Box sx={{ ...decorationStyle, width: 138, height: 138, left: 28, bottom: 78 }} />
              <Typography sx={{ fontSize: 18, fontWeight: 700, mb: 1 }}>
                Bluelayer加速器
              </Typography>
              <Typography sx={{ fontSize: 12, opacity: 0.95 }}>
                当前账户已登录
              </Typography>
              <Box
                sx={{
                  position: 'absolute',
                  left: 30,
                  right: 30,
                  bottom: 90,
                  display: 'flex',
                  justifyContent: 'space-between',
                }}
              >
                <Box>
                  <Typography sx={{ fontSize: 12, opacity: 0.88 }}>总流量</Typography>
                  <Typography sx={{ mt: 0.5, fontSize: 20, fontWeight: 700 }}>
                    {formatTraffic(total)}
                  </Typography>
                </Box>
                <Box>
                  <Typography sx={{ fontSize: 12, opacity: 0.88 }}>已用流量</Typography>
                  <Typography sx={{ mt: 0.5, fontSize: 20, fontWeight: 700 }}>
                    {formatTraffic(used)}
                  </Typography>
                </Box>
              </Box>
            </Box>

            <Box
              sx={{
                p: '56px 40px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
              }}
            >
              <Stack spacing={2.4}>
                <Box>
                  <Typography sx={{ fontSize: 32, fontWeight: 700, color: '#232f45' }}>
                    需要有效套餐
                  </Typography>
                  <Typography sx={{ mt: 1, color: '#7a8597', lineHeight: 1.7 }}>
                    当前账户已登录，但暂时没有可用的桌面套餐。完成购买或续费后，
                    客户端才能继续提供完整的加速能力。
                  </Typography>
                </Box>

                <Box
                  sx={{
                    p: 2,
                    border: '1px solid #e6e9ef',
                    background: '#fafbfd',
                  }}
                >
                  <Typography sx={{ fontSize: 13, color: '#8b93a3' }}>当前账号</Typography>
                  <Typography sx={{ mt: 0.5, fontSize: 22, fontWeight: 700, color: '#232f45' }}>
                    {userInfo?.true_name || userInfo?.username || '-'}
                  </Typography>
                  <Typography sx={{ mt: 1, fontSize: 14, color: '#61708a' }}>
                    套餐等级：Lv.{userInfo?.class ?? 0}
                  </Typography>
                  <Typography sx={{ mt: 0.5, fontSize: 14, color: '#61708a' }}>
                    到期时间：{userInfo?.class_expire || '未知'}
                  </Typography>
                </Box>

                <Button
                  variant="contained"
                  startIcon={<WorkspacePremiumRounded />}
                  onClick={() => void openPurchasePage()}
                  sx={{ height: 40, fontWeight: 700, boxShadow: 'none' }}
                >
                  升级或续费
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<SupportAgentRounded />}
                  onClick={() => void openSupportPage()}
                  sx={{ height: 40, fontWeight: 700 }}
                >
                  联系客服
                </Button>
                <Button
                  variant="text"
                  startIcon={<LogoutRounded />}
                  onClick={() => void onLogout()}
                  sx={{ alignSelf: 'flex-start', px: 0, color: '#ff5a52', fontWeight: 700 }}
                >
                  退出登录
                </Button>
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
      <Box sx={rootStyle(isLight)}>
        <Box sx={windowStyle}>
          <Box sx={sidePanelStyle(bluelayer.loginUi?.bgImg)}>
            <Box sx={{ ...decorationStyle, width: 118, height: 118, top: 34, right: 28 }} />
            <Box sx={{ ...decorationStyle, width: 138, height: 138, left: 26, bottom: 74 }} />
            <Box
              sx={{
                ...decorationStyle,
                width: 92,
                height: 92,
                left: 140,
                bottom: 170,
                background:
                  'radial-gradient(circle, rgba(255,255,255,0.3), rgba(255,255,255,0.08))',
              }}
            />

            <Typography sx={{ fontSize: 18, fontWeight: 700, mb: 1 }}>
              Bluelayer加速器
            </Typography>
            <Typography sx={{ fontSize: 12, opacity: 0.95 }}>
              {bluelayer.loginUi?.bgDesc || '谦仁网络'}
            </Typography>

          </Box>

          <Box
            component="form"
            onSubmit={(event) => {
              event.preventDefault()
              void onLogin()
            }}
            sx={{
              p: '78px 40px 40px',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <Stack spacing={3}>
              <TextField
                placeholder="用户名 (邮箱)"
                autoComplete="username"
                value={username}
                onChange={(event) => {
                  setUsername(event.target.value)
                  if (error) setError('')
                }}
                error={Boolean(usernameErrorText)}
                helperText={usernameErrorText || ' '}
                fullWidth
                variant="outlined"
                slotProps={{
                  input: {
                    sx: {
                      height: 32,
                      borderRadius: 0,
                      backgroundColor: '#ffffff',
                    },
                  },
                }}
              />

              <TextField
                placeholder="密码"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(event) => {
                  const sanitized = event.target.value.replace(/\s+/g, '')
                  setPassword(sanitized)
                  if (error) setError('')
                }}
                fullWidth
                variant="outlined"
                slotProps={{
                  input: {
                    sx: {
                      height: 32,
                      borderRadius: 0,
                      backgroundColor: '#ffffff',
                    },
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          edge="end"
                          onClick={() => setShowPassword((value) => !value)}
                          size="small"
                        >
                          {showPassword ? (
                            <VisibilityRounded fontSize="small" />
                          ) : (
                            <VisibilityOffRounded fontSize="small" />
                          )}
                        </IconButton>
                      </InputAdornment>
                    ),
                  },
                }}
              />

              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  mt: -1,
                }}
              >
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={rememberMe}
                      onChange={(event) => {
                        const checked = event.target.checked
                        setRememberMe(checked)
                        if (!checked) {
                          void saveRememberedCredentials(null)
                        }
                      }}
                      size="small"
                    />
                  }
                  label="记住密码"
                  sx={{
                    color: '#5d6c84',
                    '& .MuiTypography-root': {
                      fontSize: 14,
                    },
                  }}
                />
                <Button
                  variant="text"
                  onClick={() => void openForgotPasswordPage()}
                  sx={{ minWidth: 0, px: 0, color: '#2688ea', fontWeight: 500 }}
                >
                  忘记密码
                </Button>
              </Box>

              {error ? (
                <Alert severity="error" sx={{ borderRadius: 0 }}>
                  {error}
                </Alert>
              ) : null}

              <Button
                type="submit"
                variant="contained"
                disabled={!isUsernameValid || !password}
                sx={{
                  height: 32,
                  borderRadius: 0,
                  boxShadow: 'none',
                  fontWeight: 700,
                  fontSize: 16,
                }}
              >
                登录
              </Button>

              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, fontSize: 14 }}>
                <Typography sx={{ color: '#5d6c84', fontSize: 14 }}>还没有账号？</Typography>
                <Button
                  variant="text"
                  onClick={() => void openRegisterPage()}
                  sx={{ minWidth: 0, px: 0, color: '#2688ea', fontWeight: 500 }}
                >
                  立即注册
                </Button>
              </Box>

              <Stack direction="row" spacing={1.2} flexWrap="wrap" useFlexGap sx={{ pt: 1 }}>
                <Button
                  variant="text"
                  onClick={() => void openSupportPage()}
                  sx={{ minWidth: 0, px: 0, color: '#5d6c84', fontWeight: 500 }}
                >
                  联系客服
                </Button>
              </Stack>
            </Stack>
          </Box>
        </Box>
      </Box>
    </ThemeProvider>
  )
}
