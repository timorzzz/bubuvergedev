import { Box, Stack, Typography } from '@mui/material'

import { BasePage } from '@/components/base'
import SettingSystem from '@/components/setting/setting-system'
import SettingVergeAdvanced from '@/components/setting/setting-verge-advanced'

const SettingPage = () => {
  const onError = (err: any) => {
    console.error('[Bluelayer Settings]', err)
  }

  const panelStyle = {
    flex: 1,
    minHeight: 0,
    background: '#ffffff',
    overflowY: 'auto',
    overflowX: 'hidden',
  } as const

  return (
    <BasePage title={'\u8bbe\u7f6e'} header={<Box />} full contentStyle={{ height: '100%' }}>
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
            py: 2.2,
            borderBottom: '1px solid rgba(19, 31, 53, 0.08)',
            background:
              'linear-gradient(180deg, rgba(247, 249, 253, 0.96) 0%, rgba(255, 255, 255, 0.98) 100%)',
          }}
        >
          <Typography sx={{ fontSize: 20, fontWeight: 700, color: '#243047' }}>
            {'\u5ba2\u6237\u7aef\u8bbe\u7f6e'}
          </Typography>
          <Typography sx={{ mt: 0.55, fontSize: 13, color: '#7b8798', lineHeight: 1.6 }}>
            {
              '\u5728\u8fd9\u91cc\u96c6\u4e2d\u7ba1\u7406\u7cfb\u7edf\u4ee3\u7406\u3001\u5185\u6838\u53c2\u6570\u3001\u5ba2\u6237\u7aef\u57fa\u7840\u504f\u597d\u4ee5\u53ca\u66f4\u65b0\u76f8\u5173\u9009\u9879\u3002'
            }
          </Typography>
        </Box>

        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
          }}
        >
          <Stack
            spacing={0}
            sx={{
              minHeight: 0,
              borderRight: '1px solid rgba(19, 31, 53, 0.08)',
            }}
          >
            <Box sx={panelStyle}>
              <SettingSystem onError={onError} />
            </Box>
          </Stack>

          <Stack spacing={0} sx={{ minHeight: 0 }}>
            <Box sx={panelStyle}>
              <SettingVergeAdvanced onError={onError} />
            </Box>
          </Stack>
        </Box>
      </Box>
    </BasePage>
  )
}

export default SettingPage
