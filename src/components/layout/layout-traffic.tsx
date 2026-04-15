import {
  ArrowDownwardRounded,
  ArrowUpwardRounded,
  MemoryRounded,
} from '@mui/icons-material'
import { Box, Chip, Skeleton, Typography } from '@mui/material'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'

import { LightweightTrafficErrorBoundary } from '@/components/shared/traffic-error-boundary'
import { useMemoryData } from '@/hooks/use-memory-data'
import { useTrafficData } from '@/hooks/use-traffic-data'
import { useVerge } from '@/hooks/use-verge'
import { useVisibility } from '@/hooks/use-visibility'
import { getIpInfo } from '@/services/api'
import parseTraffic from '@/utils/parse-traffic'

import { TrafficGraph, type TrafficRef } from './traffic-graph'

// setup the traffic

const TRAFFIC_IP_CACHE_KEY = 'traffic-ip-info-cache'

function useTrafficIpInfo() {
  return useQuery({
    queryKey: [TRAFFIC_IP_CACHE_KEY],
    queryFn: getIpInfo,
    staleTime: 5 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  })
}

export const LayoutTraffic = () => {
  const { t } = useTranslation()
  const { verge } = useVerge()

  // whether hide traffic graph
  const trafficGraph = verge?.traffic_graph ?? true

  const trafficRef = useRef<TrafficRef>(null)
  const pageVisible = useVisibility()

  const {
    response: { data: traffic },
  } = useTrafficData({ enabled: trafficGraph && pageVisible })
  const {
    response: { data: memory },
  } = useMemoryData()
  const { data: ipInfo, isLoading: isIpLoading } = useTrafficIpInfo()

  // 监听数据变化，为图表添加数据点
  useEffect(() => {
    if (trafficRef.current) {
      trafficRef.current.appendData({
        up: traffic?.up || 0,
        down: traffic?.down || 0,
      })
    }
  }, [traffic])

  // 显示内存使用情况的设置
  const displayMemory = verge?.enable_memory_usage ?? true

  // 使用parseTraffic统一处理转换，保持与首页一致的显示格式
  const [up, upUnit] = parseTraffic(traffic?.up || 0)
  const [down, downUnit] = parseTraffic(traffic?.down || 0)
  const [inuse, inuseUnit] = parseTraffic(memory?.inuse || 0)

  const boxStyle: any = {
    display: 'flex',
    alignItems: 'center',
    whiteSpace: 'nowrap',
  }
  const iconStyle: any = {
    sx: { mr: '8px', fontSize: 16 },
  }
  const valStyle: any = {
    component: 'span',
    textAlign: 'center',
    sx: { flex: '1 1 56px', userSelect: 'none' },
  }
  const unitStyle: any = {
    component: 'span',
    color: 'grey.500',
    fontSize: '12px',
    textAlign: 'right',
    sx: { flex: '0 1 27px', userSelect: 'none' },
  }

  return (
    <LightweightTrafficErrorBoundary>
      <Box position="relative">
        {trafficGraph && pageVisible && (
          <div
            style={{ width: '100%', height: 60, marginBottom: 6 }}
            onClick={trafficRef.current?.toggleStyle}
          >
            <TrafficGraph ref={trafficRef} />
          </div>
        )}

        <Box display="flex" flexDirection="column" gap={0.9}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 1,
              px: 0.5,
              py: 0.25,
            }}
          >
            <Typography variant="caption" color="text.secondary">
              当前 IP
            </Typography>
            {isIpLoading ? (
              <Skeleton variant="text" width={120} height={20} />
            ) : (
              <Chip
                size="small"
                variant="outlined"
                label={ipInfo?.ip || '获取中'}
                sx={{
                  maxWidth: '100%',
                  '& .MuiChip-label': {
                    fontFamily: 'monospace',
                    fontSize: '0.75rem',
                  },
                }}
              />
            )}
          </Box>
          <Box
            title={`${t('home.components.traffic.metrics.uploadSpeed')}`}
            {...boxStyle}
            sx={{
              ...boxStyle.sx,
              // opacity: traffic?.is_fresh ? 1 : 0.6,
            }}
          >
            <ArrowUpwardRounded
              {...iconStyle}
              color={(traffic?.up || 0) > 0 ? 'secondary' : 'disabled'}
            />
            <Typography {...valStyle} color="secondary">
              {up}
            </Typography>
            <Typography {...unitStyle}>{upUnit}/s</Typography>
          </Box>

          <Box
            title={`${t('home.components.traffic.metrics.downloadSpeed')}`}
            {...boxStyle}
            sx={{
              ...boxStyle.sx,
              // opacity: traffic?.is_fresh ? 1 : 0.6,
            }}
          >
            <ArrowDownwardRounded
              {...iconStyle}
              color={(traffic?.down || 0) > 0 ? 'primary' : 'disabled'}
            />
            <Typography {...valStyle} color="primary">
              {down}
            </Typography>
            <Typography {...unitStyle}>{downUnit}/s</Typography>
          </Box>

          {displayMemory && (
            <Box
              title={`${t('home.components.traffic.metrics.memoryUsage')} `}
              {...boxStyle}
              sx={{
                cursor: 'auto',
                // opacity: memory?.is_fresh ? 1 : 0.6,
              }}
              color={'disabled'}
              onClick={async () => {
                // isDebug && (await gc());
              }}
            >
              <MemoryRounded {...iconStyle} />
              <Typography {...valStyle}>{inuse}</Typography>
              <Typography {...unitStyle}>{inuseUnit}</Typography>
            </Box>
          )}
        </Box>
      </Box>
    </LightweightTrafficErrorBoundary>
  )
}
