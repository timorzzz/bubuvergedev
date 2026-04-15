import { Box } from '@mui/material'

import { BasePage } from '@/components/base'
import { ProxyGroups } from '@/components/proxy/proxy-groups'
import { useAppData } from '@/providers/app-data-context'

const ProxyPage = () => {
  const { clashConfig } = useAppData()
  const normalizedMode = clashConfig?.mode?.toLowerCase()
  const curMode = ['rule', 'global', 'direct'].includes(normalizedMode || '')
    ? (normalizedMode as 'rule' | 'global' | 'direct')
    : 'rule'

  return (
    <BasePage
      full
      contentStyle={{ height: '100%' }}
      title="线路"
      header={<Box />}
    >
      <ProxyGroups mode={curMode} />
    </BasePage>
  )
}

export default ProxyPage
