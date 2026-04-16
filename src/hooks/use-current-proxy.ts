import { useMemo } from 'react'

import { useAppData } from '@/providers/app-data-context'

interface ProxyGroup {
  name: string
  now: string
}

export const useCurrentProxy = () => {
  const { proxies, clashConfig, refreshProxy } = useAppData()
  const currentMode = clashConfig?.mode?.toLowerCase() || 'rule'

  const currentProxyInfo = useMemo(() => {
    if (!proxies) return { currentProxy: null, primaryGroupName: null }

    const { global, groups, records } = proxies

    let primaryGroupName = 'GLOBAL'
    let currentName = global?.now

    if (currentMode === 'rule' && groups.length > 0) {
      const primaryKeywords = [
        'auto',
        'select',
        'proxy',
        '节点选择',
        '自动选择',
      ]
      const primaryGroup =
        groups.find((group: ProxyGroup) =>
          primaryKeywords.some((keyword) =>
            group.name.toLowerCase().includes(keyword.toLowerCase()),
          ),
        ) || groups.filter((g: ProxyGroup) => g.name !== 'GLOBAL')[0]

      if (primaryGroup) {
        primaryGroupName = primaryGroup.name
        currentName = primaryGroup.now
      }
    }

    if (!currentName) return { currentProxy: null, primaryGroupName }

    const currentProxy = records[currentName] || {
      name: currentName,
      type: 'Unknown',
      udp: false,
      xudp: false,
      tfo: false,
      mptcp: false,
      smux: false,
      history: [],
    }

    return { currentProxy, primaryGroupName }
  }, [proxies, currentMode])

  return {
    currentProxy: currentProxyInfo.currentProxy,
    primaryGroupName: currentProxyInfo.primaryGroupName,
    mode: currentMode,
    refreshProxy,
  }
}
