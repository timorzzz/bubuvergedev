import { Box, Grid } from '@mui/material'

import { BasePage } from '@/components/base'
import SettingClash from '@/components/setting/setting-clash'
import SettingSystem from '@/components/setting/setting-system'
import SettingVergeAdvanced from '@/components/setting/setting-verge-advanced'
import SettingVergeBasic from '@/components/setting/setting-verge-basic'

const SettingPage = () => {
  const onError = (err: any) => {
    console.error('[Bluelayer Settings]', err)
  }

  return (
    <BasePage title="设置">
      <Grid container spacing={1.5} columns={{ xs: 6, sm: 6, md: 12 }}>
        <Grid size={6}>
          <Box sx={{ borderRadius: 2, marginBottom: 1.5, backgroundColor: 'background.paper' }}>
            <SettingSystem onError={onError} />
          </Box>
          <Box sx={{ borderRadius: 2, backgroundColor: 'background.paper' }}>
            <SettingClash onError={onError} />
          </Box>
        </Grid>
        <Grid size={6}>
          <Box sx={{ borderRadius: 2, backgroundColor: 'background.paper' }}>
            <SettingVergeBasic onError={onError} />
          </Box>
          <Box
            sx={{
              borderRadius: 2,
              marginTop: 1.5,
              backgroundColor: 'background.paper',
            }}
          >
            <SettingVergeAdvanced onError={onError} />
          </Box>
        </Grid>
      </Grid>
    </BasePage>
  )
}

export default SettingPage
