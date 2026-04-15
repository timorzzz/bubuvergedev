import type {
  DraggableAttributes,
  DraggableSyntheticListeners,
} from '@dnd-kit/core'
import {
  alpha,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Tooltip,
} from '@mui/material'
import type { CSSProperties, ReactNode } from 'react'
import { useMatch, useNavigate, useResolvedPath } from 'react-router'

import { useVerge } from '@/hooks/use-verge'

interface SortableProps {
  setNodeRef?: (element: HTMLElement | null) => void
  attributes?: DraggableAttributes
  listeners?: DraggableSyntheticListeners
  style?: CSSProperties
  isDragging?: boolean
  disabled?: boolean
}

interface Props {
  to?: string
  children: string
  icon: ReactNode[]
  onClick?: () => void
  sortable?: SortableProps
}

export const LayoutItem = ({ to, children, icon, onClick, sortable }: Props) => {
  const { verge } = useVerge()
  const { menu_icon } = verge ?? {}
  const resolved = useResolvedPath(to || '/')
  const match = to ? useMatch({ path: resolved.pathname, end: true }) : null
  const navigate = useNavigate()

  const { setNodeRef, attributes, listeners, style, isDragging, disabled } =
    sortable ?? {}

  const draggable = Boolean(sortable) && !disabled
  const dragHandleProps = draggable
    ? { ...(attributes ?? {}), ...(listeners ?? {}) }
    : undefined

  const renderedIcon = menu_icon === 'colorful' ? icon[1] : icon[0]

  return (
    <Tooltip title={children} placement="right">
      <ListItem
        ref={setNodeRef}
        style={style}
        sx={{
          py: 0.5,
          px: 0,
          display: 'flex',
          justifyContent: 'center',
          opacity: isDragging ? 0.78 : 1,
        }}
      >
        <ListItemButton
          selected={!!match}
          {...(dragHandleProps ?? {})}
          title={children}
          aria-label={children}
          onClick={() => {
            if (onClick) {
              onClick()
              return
            }
            if (to) {
              navigate(to)
            }
          }}
          sx={(theme) => ({
            width: 68,
            minWidth: 68,
            minHeight: 74,
            borderRadius: 2,
            justifyContent: 'center',
            alignItems: 'center',
            flexDirection: 'column',
            gap: 0.5,
            p: '8px 4px 6px',
            color:
              theme.palette.mode === 'light'
                ? '#6b7689'
                : 'rgba(255,255,255,0.7)',
            cursor: draggable ? 'grab' : 'pointer',
            '&:active': draggable ? { cursor: 'grabbing' } : undefined,
            '& .MuiListItemIcon-root': {
              minWidth: 0,
              m: 0,
              color: 'inherit',
              '& > *': {
                fontSize: 30,
              },
            },
            '& .MuiListItemText-root': {
              display: 'block',
              margin: 0,
              textAlign: 'center',
              '& .MuiTypography-root': {
                fontSize: 12,
                lineHeight: 1.15,
                fontWeight: 500,
                color: 'inherit',
              },
            },
            '&:hover': {
              backgroundColor:
                theme.palette.mode === 'light'
                  ? alpha(theme.palette.primary.main, 0.08)
                  : alpha(theme.palette.primary.main, 0.16),
              color: theme.palette.primary.main,
            },
            '&.Mui-selected': {
              backgroundColor:
                theme.palette.mode === 'light'
                  ? alpha(theme.palette.primary.main, 0.14)
                  : alpha(theme.palette.primary.main, 0.22),
              color: theme.palette.primary.main,
              '& .MuiTypography-root': {
                fontWeight: 700,
              },
            },
            '&.Mui-selected:hover': {
              backgroundColor:
                theme.palette.mode === 'light'
                  ? alpha(theme.palette.primary.main, 0.18)
                  : alpha(theme.palette.primary.main, 0.28),
            },
          })}
        >
          <ListItemIcon>{renderedIcon}</ListItemIcon>
          <ListItemText primary={children} />
        </ListItemButton>
      </ListItem>
    </Tooltip>
  )
}
