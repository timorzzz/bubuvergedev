import { getVergeConfig } from './cmds'
import {
  cacheLanguage,
  initializeLanguage,
  FALLBACK_LANGUAGE,
} from './i18n'

let vergeConfigCache: IVergeConfig | null | undefined

export const resolveThemeMode = (
  vergeConfig?: IVergeConfig | null,
): 'light' | 'dark' => {
  void vergeConfig
  return 'light'
}

export const setPreloadConfig = (config: IVergeConfig | null) => {
  vergeConfigCache = config
}

export const getPreloadConfig = () => vergeConfigCache

export const preloadConfig = async () => {
  try {
    const config = await getVergeConfig()
    setPreloadConfig(config)
    return config
  } catch (error) {
    console.warn('[preload.ts] Failed to read Verge config:', error)
    setPreloadConfig(null)
    return null
  }
}

export const preloadLanguage = async (
  vergeConfig?: IVergeConfig | null,
  loadConfig: () => Promise<IVergeConfig | null> = preloadConfig,
) => {
  void vergeConfig
  void loadConfig
  cacheLanguage(FALLBACK_LANGUAGE)
  return FALLBACK_LANGUAGE
}

export const preloadAppData = async () => {
  const configPromise = preloadConfig()
  const initialLanguage = await preloadLanguage(undefined, () => configPromise)
  const [config] = await Promise.all([
    configPromise,
    initializeLanguage(initialLanguage),
  ])
  const initialThemeMode = resolveThemeMode(config)
  return { initialThemeMode }
}
