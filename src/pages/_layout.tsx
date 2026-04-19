import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable'
import { open as openUrl } from '@tauri-apps/plugin-shell'
import { CSS } from '@dnd-kit/utilities'
import { List, Menu, MenuItem, Paper, ThemeProvider } from '@mui/material'
import { version as appVersion } from '@root/package.json'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import type { CSSProperties } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import { Outlet, useLocation, useNavigate } from 'react-router'
import rehypeRaw from 'rehype-raw'

import brandLogo from '@/assets/image/bluelayer-logo.png'
import { BaseDialog, BaseErrorBoundary } from '@/components/base'
import { BluelayerGate } from '@/components/bluelayer/bluelayer-gate'
import { LayoutItem } from '@/components/layout/layout-item'
import { NoticeManager } from '@/components/layout/notice-manager'
import { WindowControls } from '@/components/layout/window-controller'
import { updateLastCheckTime } from '@/hooks/use-update'
import { useI18n } from '@/hooks/use-i18n'
import { useVerge } from '@/hooks/use-verge'
import { useWindowDecorations } from '@/hooks/use-window'
import {
  canUseBluelayer,
  dismissPcAlert,
  fetchPcAlert,
  useBluelayerState,
} from '@/services/bluelayer'
import { showNotice } from '@/services/notice-service'
import { queryClient } from '@/services/query-client'
import { useThemeMode } from '@/services/states'
import { checkUpdateSafe, type Update } from '@/services/update'
import getSystem from '@/utils/get-system'

import {
  useCustomTheme,
  useLayoutEvents,
  useLoadingOverlay,
  useNavMenuOrder,
} from './_layout/hooks'
import { handleNoticeMessage } from './_layout/utils'
import { navItems } from './_routers'
import LogsPage from './logs'

import 'dayjs/locale/ru'
import 'dayjs/locale/zh-cn'

export const portableFlag = false

type NavItem = (typeof navItems)[number]

type MenuContextPosition = { top: number; left: number }
type PcAlertState = { title: string; content: string; hash: string } | null
type PcUpdateState = Update | null

interface SortableNavMenuItemProps {
  item: NavItem
  label: string
}

const SortableNavMenuItem = ({ item, label }: SortableNavMenuItemProps) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: item.path,
  })

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  if (isDragging) {
    style.zIndex = 100
  }

  return (
    <LayoutItem
      to={item.path}
      icon={item.icon}
      sortable={{
        setNodeRef,
        attributes,
        listeners,
        style,
        isDragging,
      }}
    >
      {label}
    </LayoutItem>
  )
}

dayjs.extend(relativeTime)

const displayVersion = String(appVersion).split('+')[0]

const OS = getSystem()

const Layout = () => {
  const mode = useThemeMode()
  const bluelayer = useBluelayerState()
  const { t } = useTranslation()
  const { theme } = useCustomTheme()
  const { verge, mutateVerge, patchVerge } = useVerge()
  const { language } = verge ?? {}
  const navCollapsed = verge?.collapse_navbar ?? false
  const { switchLanguage } = useI18n()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const isLogsPage = pathname === '/logs'
  const logsPageMountedRef = useRef(false)
  const { decorated } = useWindowDecorations()
  const windowControlsRef = useRef<any>(null)
  const themeReady = useMemo(() => Boolean(theme), [theme])
  const pcAlertSessionRef = useRef('')
  const pcUpdateSessionRef = useRef('')

  if (isLogsPage) logsPageMountedRef.current = true

  const [menuUnlocked, setMenuUnlocked] = useState(false)
  const [menuContextPosition, setMenuContextPosition] =
    useState<MenuContextPosition | null>(null)
  const [pcAlert, setPcAlert] = useState<PcAlertState>(null)
  const [pcUpdate, setPcUpdate] = useState<PcUpdateState>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const handleMenuOrderOptimisticUpdate = useCallback(
    (order: string[]) => {
      mutateVerge(
        (prev) => (prev ? { ...prev, menu_order: order } : prev),
        false,
      )
    },
    [mutateVerge],
  )

  const handleMenuOrderPersist = useCallback(
    (order: string[]) => patchVerge({ menu_order: order }),
    [patchVerge],
  )

  const {
    menuOrder,
    navItemMap,
    handleMenuDragEnd,
    isDefaultOrder,
    resetMenuOrder,
  } = useNavMenuOrder({
    enabled: menuUnlocked,
    items: navItems,
    storedOrder: verge?.menu_order,
    onOptimisticUpdate: handleMenuOrderOptimisticUpdate,
    onPersist: handleMenuOrderPersist,
  })

  const handleMenuContextMenu = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      event.preventDefault()
      event.stopPropagation()
      setMenuContextPosition({ top: event.clientY, left: event.clientX })
    },
    [],
  )

  const handleMenuContextClose = useCallback(() => {
    setMenuContextPosition(null)
  }, [])

  const handleResetMenuOrder = useCallback(() => {
    setMenuContextPosition(null)
    void resetMenuOrder()
  }, [resetMenuOrder])

  const handleUnlockMenu = useCallback(() => {
    setMenuUnlocked(true)
    setMenuContextPosition(null)
  }, [])

  const handleLockMenu = useCallback(() => {
    setMenuUnlocked(false)
    setMenuContextPosition(null)
  }, [])

  const handleToggleNavCollapsed = useCallback(() => {
    setMenuContextPosition(null)
    void patchVerge({ collapse_navbar: !navCollapsed })
  }, [navCollapsed, patchVerge])

  useLoadingOverlay(themeReady)

  const handleNotice = useCallback(
    (payload: [string, string]) => {
      const [status, msg] = payload
      try {
        handleNoticeMessage(status, msg, t, navigate)
      } catch (error) {
        console.error('[notice] failed:', error)
      }
    },
    [t, navigate],
  )

  useLayoutEvents(handleNotice)

  useEffect(() => {
    if (language) {
      dayjs.locale(language === 'zh' ? 'zh-cn' : language)
      switchLanguage(language)
    }
  }, [language, switchLanguage])

  useEffect(() => {
    if (!bluelayer.authenticated || !canUseBluelayer(bluelayer.session)) {
      pcAlertSessionRef.current = ''
      setPcAlert(null)
      return
    }

    const sessionKey = `${bluelayer.session?.username ?? ''}:${bluelayer.session?.createdAt ?? 0}`
    if (!sessionKey || pcAlertSessionRef.current === sessionKey) return

    pcAlertSessionRef.current = sessionKey
    let alive = true

    void fetchPcAlert()
      .then((alert) => {
        if (!alive || !alert) return
        setPcAlert(alert)
      })
      .catch(() => null)

    return () => {
      alive = false
    }
  }, [bluelayer.authenticated, bluelayer.session])

  useEffect(() => {
    if (!bluelayer.authenticated || !canUseBluelayer(bluelayer.session)) {
      pcUpdateSessionRef.current = ''
      setPcUpdate(null)
      return
    }

    const sessionKey = `${bluelayer.session?.username ?? ''}:${bluelayer.session?.createdAt ?? 0}`
    if (!sessionKey || pcUpdateSessionRef.current === sessionKey) return

    pcUpdateSessionRef.current = sessionKey
    let alive = true

    void checkUpdateSafe()
      .then((updateInfo) => {
        if (!alive) return
        updateLastCheckTime()
        queryClient.setQueryData(['checkUpdate'], updateInfo)
        if (updateInfo?.available) {
          setPcUpdate(updateInfo)
        }
      })
      .catch(() => null)

    return () => {
      alive = false
    }
  }, [bluelayer.authenticated, bluelayer.session])

  const handleClosePcAlert = useCallback(() => {
    if (pcAlert?.hash) {
      dismissPcAlert(pcAlert.hash)
    }
    setPcAlert(null)
  }, [pcAlert])

  const handleClosePcUpdate = useCallback(() => {
    setPcUpdate(null)
  }, [])

  const handleOpenPcUpdate = useCallback(async () => {
    if (!pcUpdate?.downloadUrl) {
      setPcUpdate(null)
      return
    }

    try {
      await openUrl(pcUpdate.downloadUrl)
      setPcUpdate(null)
    } catch (error) {
      showNotice.error(error)
    }
  }, [pcUpdate])

  if (
    !bluelayer.ready ||
    !bluelayer.authenticated ||
    !canUseBluelayer(bluelayer.session)
  ) {
    return <BluelayerGate />
  }

  if (!themeReady) {
    return (
      <div
        style={{
          width: '100vw',
          height: '100vh',
          background: mode === 'light' ? '#fffaf2' : '#0b0b0d',
        }}
      />
    )
  }

  const titleText = `Bluelayer - ${
    verge?.enable_tun_mode || verge?.enable_system_proxy ? '已连接' : '未连接'
  }`

  const customTitlebar = !decorated ? (
    <div className="the_titlebar" data-tauri-drag-region="true">
      <div className="the-titlebar-spacer" />
      <div className="the-titlebar-label" data-tauri-drag-region="true">
        <span
          className="status-dot"
          style={{
            color:
              verge?.enable_tun_mode || verge?.enable_system_proxy
                ? '#34c759'
                : '#ff9f1c',
          }}
        />
        <span>{titleText}</span>
      </div>
      <WindowControls ref={windowControlsRef} />
    </div>
  ) : null

  return (
    <ThemeProvider theme={theme}>
      <NoticeManager position={verge?.notice_position} />
      <BaseDialog
        open={Boolean(pcAlert)}
        title={pcAlert?.title || '公告'}
        okBtn="知道了"
        disableCancel
        onOk={handleClosePcAlert}
        onClose={handleClosePcAlert}
        contentSx={{ minWidth: 360, maxWidth: 520 }}
      >
        <div
          dangerouslySetInnerHTML={{ __html: pcAlert?.content || '' }}
          style={{
            lineHeight: 1.7,
            wordBreak: 'break-word',
          }}
        />
      </BaseDialog>
      <BaseDialog
        open={Boolean(pcUpdate?.available)}
        title={
          pcUpdate?.version
            ? `\u53d1\u73b0\u65b0\u7248\u672c ${pcUpdate.version}`
            : '\u53d1\u73b0\u65b0\u7248\u672c'
        }
        okBtn={
          pcUpdate?.downloadUrl
            ? '\u7acb\u5373\u4e0b\u8f7d'
            : '\u77e5\u9053\u4e86'
        }
        cancelBtn={pcUpdate?.downloadUrl ? '\u7a0d\u540e' : undefined}
        disableCancel={!pcUpdate?.downloadUrl}
        onOk={handleOpenPcUpdate}
        onCancel={handleClosePcUpdate}
        onClose={handleClosePcUpdate}
        contentSx={{ minWidth: 360, maxWidth: 520, maxHeight: '60vh' }}
      >
        <div style={{ lineHeight: 1.7, wordBreak: 'break-word' }}>
          <ReactMarkdown rehypePlugins={[rehypeRaw]}>
            {pcUpdate?.body ||
              '\u68c0\u6d4b\u5230\u65b0\u7248\u672c\uff0c\u53ef\u524d\u5f80\u4e0b\u8f7d\u66f4\u65b0\u3002'}
          </ReactMarkdown>
        </div>
      </BaseDialog>
      <Paper
        square
        elevation={0}
        className={`${OS} layout${navCollapsed ? ' layout--nav-collapsed' : ''}`}
        onContextMenu={(event) => {
          if (
            OS === 'windows' &&
            !['input', 'textarea'].includes(
              event.currentTarget.tagName.toLowerCase(),
            ) &&
            !event.currentTarget.isContentEditable
          ) {
            event.preventDefault()
          }
        }}
        sx={{
          bgcolor: 'background.default',
          borderRadius: 0,
          width: '100vw',
          height: '100vh',
        }}
      >
        {customTitlebar}

        <div className="layout-content">
          <div className="layout-content__left">
            <div className="the-logo" data-tauri-drag-region="false">
              <div className="the-logo-mark">
                <img src={brandLogo} alt="Bluelayer" />
              </div>
            </div>

            {menuUnlocked ? (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleMenuDragEnd}
              >
                <SortableContext items={menuOrder}>
                  <List
                    className="the-menu"
                    onContextMenu={handleMenuContextMenu}
                  >
                    {menuOrder.map((path) => {
                      const item = navItemMap.get(path)
                      if (!item) return null
                      return (
                        <SortableNavMenuItem
                          key={item.path}
                          item={item}
                          label={item.label}
                        />
                      )
                    })}
                  </List>
                </SortableContext>
              </DndContext>
            ) : (
              <List className="the-menu" onContextMenu={handleMenuContextMenu}>
                {menuOrder.map((path) => {
                  const item = navItemMap.get(path)
                  if (!item) return null
                  return (
                    <LayoutItem key={item.path} to={item.path} icon={item.icon}>
                      {item.label}
                    </LayoutItem>
                  )
                })}
              </List>
            )}

            <Menu
              open={Boolean(menuContextPosition)}
              onClose={handleMenuContextClose}
              anchorReference="anchorPosition"
              anchorPosition={
                menuContextPosition
                  ? {
                      top: menuContextPosition.top,
                      left: menuContextPosition.left,
                    }
                  : undefined
              }
              transitionDuration={200}
              slotProps={{
                list: {
                  sx: { py: 0.5 },
                },
              }}
            >
              <MenuItem onClick={handleToggleNavCollapsed} dense>
                {navCollapsed
                  ? t('layout.components.navigation.menu.expandNavBar')
                  : t('layout.components.navigation.menu.collapseNavBar')}
              </MenuItem>
              <MenuItem
                onClick={menuUnlocked ? handleLockMenu : handleUnlockMenu}
                dense
              >
                {menuUnlocked
                  ? t('layout.components.navigation.menu.lock')
                  : t('layout.components.navigation.menu.unlock')}
              </MenuItem>
              <MenuItem
                onClick={handleResetMenuOrder}
                dense
                disabled={isDefaultOrder}
              >
                {t('layout.components.navigation.menu.restoreDefaultOrder')}
              </MenuItem>
            </Menu>

            <div className="the-version">v{displayVersion}</div>
          </div>

          <div className="layout-content__right">
            <div className="the-content">
              <BaseErrorBoundary>
                <Outlet />
              </BaseErrorBoundary>
              {logsPageMountedRef.current && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: isLogsPage ? undefined : 'none',
                  }}
                >
                  <LogsPage />
                </div>
              )}
            </div>
          </div>
        </div>
      </Paper>
    </ThemeProvider>
  )
}

export default Layout
