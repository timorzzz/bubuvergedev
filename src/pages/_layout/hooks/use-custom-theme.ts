import { alpha, createTheme, Theme as MuiTheme, Shadows } from '@mui/material'
import {
  getCurrentWebviewWindow,
  WebviewWindow,
} from '@tauri-apps/api/webviewWindow'
import { Theme as TauriOsTheme } from '@tauri-apps/api/window'
import { useEffect, useMemo } from 'react'

import { useVerge } from '@/hooks/use-verge'
import { defaultDarkTheme, defaultTheme } from '@/pages/_theme'
import { useSetThemeMode, useThemeMode } from '@/services/states'

const CSS_INJECTION_SCOPE_ROOT = '[data-css-injection-root]'
const CSS_INJECTION_SCOPE_LIMIT =
  ':is(.monaco-editor .view-lines, .monaco-editor .view-line, .monaco-editor .margin, .monaco-editor .margin-view-overlays, .monaco-editor .view-overlays, .monaco-editor [class^="mtk"], .monaco-editor [class*=" mtk"])'
const TOP_LEVEL_AT_RULES = [
  '@charset',
  '@import',
  '@namespace',
  '@font-face',
  '@keyframes',
  '@counter-style',
  '@page',
  '@property',
  '@font-feature-values',
  '@color-profile',
]
let cssScopeSupport: boolean | null = null

const canUseCssScope = () => {
  if (cssScopeSupport !== null) {
    return cssScopeSupport
  }
  try {
    const testStyle = document.createElement('style')
    testStyle.textContent = '@scope (:root) { }'
    document.head.appendChild(testStyle)
    cssScopeSupport = !!testStyle.sheet?.cssRules?.length
    document.head.removeChild(testStyle)
  } catch {
    cssScopeSupport = false
  }
  return cssScopeSupport
}

const wrapCssInjectionWithScope = (css?: string) => {
  if (!css?.trim()) {
    return ''
  }
  const lowerCss = css.toLowerCase()
  const hasTopLevelOnlyRule = TOP_LEVEL_AT_RULES.some((rule) =>
    lowerCss.includes(rule),
  )
  if (hasTopLevelOnlyRule) {
    return null
  }
  const scopeRoot = CSS_INJECTION_SCOPE_ROOT
  const scopeLimit = CSS_INJECTION_SCOPE_LIMIT
  const scopedBlock = `@scope (${scopeRoot}) to (${scopeLimit}) {
${css}
}`
  return scopedBlock
}

export const useCustomTheme = () => {
  const appWindow: WebviewWindow = useMemo(() => getCurrentWebviewWindow(), [])
  const { verge } = useVerge()
  const { theme_setting } = verge ?? {}
  const mode = useThemeMode()
  const setMode = useSetThemeMode()
  const userBackgroundImage = theme_setting?.background_image || ''
  const hasUserBackground = !!userBackgroundImage

  useEffect(() => {
    setMode('light')
  }, [setMode])

  useEffect(() => {
    appWindow.setTheme('light' as TauriOsTheme).catch((err) => {
      console.error('Failed to force window theme to light:', err)
    })
  }, [appWindow])

  const theme = useMemo(() => {
    const setting = theme_setting || {}
    const dt = defaultTheme
    let muiTheme: MuiTheme

    try {
      muiTheme = createTheme({
        breakpoints: {
          values: { xs: 0, sm: 650, md: 900, lg: 1200, xl: 1536 },
        },
        palette: {
          mode: 'light',
          primary: { main: setting.primary_color || dt.primary_color },
          secondary: { main: setting.secondary_color || dt.secondary_color },
          info: { main: setting.info_color || dt.info_color },
          error: { main: setting.error_color || dt.error_color },
          warning: { main: setting.warning_color || dt.warning_color },
          success: { main: setting.success_color || dt.success_color },
          text: {
            primary: setting.primary_text || dt.primary_text,
            secondary: setting.secondary_text || dt.secondary_text,
          },
          background: {
            paper: dt.background_color,
            default: dt.background_color,
          },
        },
        shadows: Array(25).fill('none') as Shadows,
        typography: {
          htmlFontSize: 16,
          fontSize: 14,
          fontFamily: setting.font_family
            ? `${setting.font_family}, ${dt.font_family}`
            : dt.font_family,
        },
      })
    } catch (e) {
      console.error('Error creating MUI theme, falling back to defaults:', e)
        muiTheme = createTheme({
        breakpoints: {
          values: { xs: 0, sm: 650, md: 900, lg: 1200, xl: 1536 },
        },
        palette: {
          mode: 'light',
          primary: { main: dt.primary_color },
          secondary: { main: dt.secondary_color },
          info: { main: dt.info_color },
          error: { main: dt.error_color },
          warning: { main: dt.warning_color },
          success: { main: dt.success_color },
          text: { primary: dt.primary_text, secondary: dt.secondary_text },
          background: {
            paper: dt.background_color,
            default: dt.background_color,
          },
        },
        typography: {
          htmlFontSize: 16,
          fontSize: 14,
          fontFamily: dt.font_family,
        },
      })
    }

    const rootEle = document.documentElement
    if (rootEle) {
      const backgroundColor = '#f3efe7'
      const selectColor = '#fff4df'
      const scrollColor = '#b18f6488'
      const dividerColor = 'rgba(31, 24, 16, 0.08)'

      rootEle.style.setProperty('--divider-color', dividerColor)
      rootEle.style.setProperty('--background-color', backgroundColor)
      rootEle.style.setProperty(
        '--shell-surface',
        'rgba(255, 250, 242, 0.88)',
      )
      rootEle.style.setProperty(
        '--shell-surface-soft',
        'linear-gradient(180deg, rgba(255, 255, 255, 0.82), rgba(255, 244, 223, 0.78))',
      )
      rootEle.style.setProperty(
        '--shell-panel-bg',
        'linear-gradient(180deg, rgba(255, 255, 255, 0.7), rgba(255, 248, 238, 0.92))',
      )
      rootEle.style.setProperty(
        '--shell-text-primary',
        '#1f1810',
      )
      rootEle.style.setProperty(
        '--shell-text-secondary',
        'rgba(31, 24, 16, 0.68)',
      )
      rootEle.style.setProperty(
        '--shell-shadow',
        '0 24px 60px rgba(20, 16, 10, 0.12)',
      )
      rootEle.style.setProperty('--selection-color', selectColor)
      rootEle.style.setProperty('--scroller-color', scrollColor)
      rootEle.style.setProperty('--primary-main', muiTheme.palette.primary.main)
      rootEle.style.setProperty(
        '--background-color-alpha',
        alpha(muiTheme.palette.primary.main, 0.1),
      )
      rootEle.style.setProperty(
        '--window-border-color',
        '#d7c8ae',
      )
      rootEle.style.setProperty(
        '--scrollbar-bg',
        '#efe1c8',
      )
      rootEle.style.setProperty(
        '--scrollbar-thumb',
        '#c19a63',
      )
      rootEle.style.setProperty(
        '--user-background-image',
        hasUserBackground ? `url('${userBackgroundImage}')` : 'none',
      )
      rootEle.style.setProperty(
        '--background-blend-mode',
        setting.background_blend_mode || 'normal',
      )
      rootEle.style.setProperty(
        '--background-opacity',
        setting.background_opacity !== undefined
          ? String(setting.background_opacity)
          : '1',
      )
      rootEle.setAttribute('data-css-injection-root', 'true')
    }

    let styleElement = document.querySelector('style#verge-theme')
    if (!styleElement) {
      styleElement = document.createElement('style')
      styleElement.id = 'verge-theme'
      document.head.appendChild(styleElement!)
    }

    if (styleElement) {
      let scopedCss: string | null = null
      if (canUseCssScope() && setting.css_injection) {
        scopedCss = wrapCssInjectionWithScope(setting.css_injection)
      }

      const effectiveInjectedCss = scopedCss ?? setting.css_injection ?? ''
      const globalStyles = `
        ::-webkit-scrollbar {
          width: 8px;
          height: 8px;
          background-color: var(--scrollbar-bg);
        }
        ::-webkit-scrollbar-thumb {
          background-color: var(--scrollbar-thumb);
          border-radius: 4px;
        }
        ::-webkit-scrollbar-thumb:hover {
          background-color: ${mode === 'light' ? '#a17a45' : '#8b949e'};
        }

        body {
          background-color: var(--background-color);
          background-image:
            radial-gradient(circle at top, rgba(255, 159, 28, 0.16), transparent 28%),
            radial-gradient(circle at bottom right, rgba(255, 214, 102, 0.08), transparent 24%);
          ${
            hasUserBackground
              ? `
            background-image:
              linear-gradient(rgba(11, 11, 13, 0.72), rgba(11, 11, 13, 0.9)),
              var(--user-background-image);
            background-size: cover;
            background-position: center;
            background-attachment: fixed;
            background-blend-mode: var(--background-blend-mode);
            opacity: var(--background-opacity);
          `
              : ''
          }
        }

        .MuiPaper-root {
          border-color: var(--window-border-color) !important;
        }

        .MuiDialog-paper {
          background-color: #fffaf2 !important;
          border: 1px solid rgba(31, 24, 16, 0.08) !important;
          box-shadow: 0 24px 60px rgba(20, 16, 10, 0.14) !important;
        }
      `

      styleElement.innerHTML = effectiveInjectedCss + globalStyles
    }

    return muiTheme
  }, [theme_setting, userBackgroundImage, hasUserBackground])

  useEffect(() => {
    const id = setTimeout(() => {
      const dom = document.querySelector('#Gradient2')
      if (dom) {
        dom.innerHTML = `
        <stop offset="0%" stop-color="${theme.palette.primary.main}" />
        <stop offset="80%" stop-color="${theme.palette.primary.dark}" />
        <stop offset="100%" stop-color="${theme.palette.primary.dark}" />
        `
      }
    }, 0)
    return () => clearTimeout(id)
  }, [theme.palette.primary.main, theme.palette.primary.dark])

  return { theme }
}
