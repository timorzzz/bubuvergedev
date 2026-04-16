import { fetch } from '@tauri-apps/plugin-http'
import { useSyncExternalStore } from 'react'
import { version as appVersion } from '@root/package.json'

import {
  calcuProxies,
  createProfile,
  decryptLocalData,
  deleteProfile,
  encryptLocalData,
  enhanceProfiles,
  getProfiles,
  openBluelayerPanelWindow,
  patchProfilesConfig,
  patchProfile,
  saveProfileFile,
} from '@/services/cmds'
import { queryClient } from '@/services/query-client'

export const BLUELAYER_LOGIN_CONFIG_URL =
  'https://blue-1417110065.cos.ap-guangzhou.myqcloud.com/config/loginconfig/login.json'
export const BLUELAYER_LOGIN_CONFIG_BACKUP_URL =
  'https://blue111link.oss-cn-beijing.aliyuncs.com/config/url/login.json'
export const BLUELAYER_FALLBACK_PANEL_URL =
  'https://client.aerospacebiology.net'
export const BLUELAYER_UPDATE_BASE_URL = 'https://bluelayer.uk'
export const BLUELAYER_PROFILE_NAME = 'Bluelayer'
const BLUELAYER_PROFILE_DESC = 'bluelayer-managed-profile'
const BLUELAYER_SESSION_KEY = 'bluelayer_session_v1'
const BLUELAYER_SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000
const BLUELAYER_SUBSCRIPTION_CACHE_KEY = 'bluelayer_subscription_cache_v1'
const BLUELAYER_CREDENTIALS_KEY = 'bluelayer_credentials_v1'
const BLUELAYER_LOGIN_CONFIG_CACHE_KEY = 'bluelayer_login_config_cache_v1'
const BLUELAYER_PANEL_CACHE_KEY = 'bluelayer_panel_cache_v1'
const BLUELAYER_FULL_CONFIG_CACHE_KEY = 'bluelayer_full_config_cache_v1'
const BLUELAYER_SUBSCRIPTION_CACHE_TTL = 24 * 60 * 60 * 1000
const BLUELAYER_LOGIN_CONFIG_CACHE_TTL = 30 * 60 * 1000
const BLUELAYER_PANEL_CACHE_TTL = 30 * 60 * 1000
const BLUELAYER_FULL_CONFIG_CACHE_TTL = 30 * 60 * 1000
const V1_KEY = 'RocketMaker'

type LoginConfig = {
  panels: string[]
  purchase_path?: string
}

type LoginUiConfig = {
  bgImg?: string
  bgDesc?: string
}

type NavItemConfig = {
  desc?: string
  color?: string
  link?: string
}

export type BluelayerPcUpdateEnvelope = {
  baseUrl: string
  payload: {
    code: number
    info: string
    data?: unknown
  }
}

type UserInfo = {
  username?: string
  true_name?: string
  balance?: number
  class?: number
  class_expire?: string
  node_speedlimit?: string
  node_connector?: string
  defaultProxy?: string
  pc_sub?: string
  android_sub?: string[]
  traffic?: {
    total?: number
    used?: number
  }
}

type StoredSession = {
  username: string
  cookie?: string
  updateCookie?: string
  panelIndex: number
  createdAt: number
  userInfo: UserInfo
}

type ManagedSubscriptionCache = {
  fetchedAt: number
  baseUrl: string
  subscriptionUrl: string
}

type RememberedCredentials = {
  username: string
  password: string
}

type CachedRecord<T> = {
  value: T
  savedAt: number
}

type ResolvedPanel = {
  baseUrl: string
  panelIndex: number
  purchasePath: string
}

type BluelayerState = {
  ready: boolean
  checking: boolean
  authenticated: boolean
  session: StoredSession | null
  loginUi?: LoginUiConfig | null
  nav?: NavItemConfig[] | null
}

const defaultState: BluelayerState = {
  ready: false,
  checking: false,
  authenticated: false,
  session: null,
  loginUi: null,
  nav: null,
}

let state: BluelayerState = defaultState
let bootstrapPromise: Promise<void> | null = null
let loginConfigPromise: Promise<LoginConfig> | null = null
let panelResolvePromise: Promise<ResolvedPanel> | null = null
let subscriptionRefreshPromise: Promise<StoredSession> | null = null
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((listener) => listener())
}

function setState(patch: Partial<BluelayerState>) {
  state = { ...state, ...patch }
  emit()
}

function resetState() {
  state = { ...defaultState }
  emit()
}

function getStoredSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(BLUELAYER_SESSION_KEY)
    if (!raw) return null
    return JSON.parse(raw) as StoredSession
  } catch {
    return null
  }
}

function saveStoredSession(session: StoredSession | null) {
  if (!session) {
    localStorage.removeItem(BLUELAYER_SESSION_KEY)
    return
  }
  localStorage.setItem(BLUELAYER_SESSION_KEY, JSON.stringify(session))
}

function getManagedSubscriptionCache(): ManagedSubscriptionCache | null {
  try {
    const raw = localStorage.getItem(BLUELAYER_SUBSCRIPTION_CACHE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as ManagedSubscriptionCache
  } catch {
    return null
  }
}

function saveManagedSubscriptionCache(cache: ManagedSubscriptionCache | null) {
  if (!cache) {
    localStorage.removeItem(BLUELAYER_SUBSCRIPTION_CACHE_KEY)
    return
  }
  localStorage.setItem(BLUELAYER_SUBSCRIPTION_CACHE_KEY, JSON.stringify(cache))
}

function clearManagedSubscriptionCache() {
  saveManagedSubscriptionCache(null)
}

function getCachedRecord<T>(key: string, ttl: number): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedRecord<T>
    if (!parsed?.savedAt || Date.now() - parsed.savedAt >= ttl) {
      localStorage.removeItem(key)
      return null
    }
    return parsed.value ?? null
  } catch {
    localStorage.removeItem(key)
    return null
  }
}

function saveCachedRecord<T>(key: string, value: T | null) {
  if (!value) {
    localStorage.removeItem(key)
    return
  }
  const payload: CachedRecord<T> = {
    value,
    savedAt: Date.now(),
  }
  localStorage.setItem(key, JSON.stringify(payload))
}

export async function getRememberedCredentials(): Promise<RememberedCredentials | null> {
  try {
    const raw = localStorage.getItem(BLUELAYER_CREDENTIALS_KEY)
    if (!raw) return null
    const decrypted = await decryptLocalData(raw)
    return JSON.parse(decrypted) as RememberedCredentials
  } catch {
    localStorage.removeItem(BLUELAYER_CREDENTIALS_KEY)
    return null
  }
}

export async function saveRememberedCredentials(
  credentials: RememberedCredentials | null,
) {
  if (!credentials) {
    localStorage.removeItem(BLUELAYER_CREDENTIALS_KEY)
    return
  }
  const encrypted = await encryptLocalData(JSON.stringify(credentials))
  localStorage.setItem(BLUELAYER_CREDENTIALS_KEY, encrypted)
}

function normalizeBaseUrl(url: string) {
  return url.replace(/\/+$/, '')
}

function toAbsoluteUrl(baseUrl: string, input?: string) {
  if (!input) return ''
  if (/^https?:\/\//i.test(input)) return input
  const safeBase = normalizeBaseUrl(baseUrl)
  return `${safeBase}${input.startsWith('/') ? input : `/${input}`}`
}

function rc4(text: string, key: string) {
  const s = Array.from({ length: 256 }, (_, i) => i)
  let j = 0
  for (let i = 0; i < 256; i += 1) {
    j = (j + s[i] + key.charCodeAt(i % key.length)) % 256
    ;[s[i], s[j]] = [s[j], s[i]]
  }

  let i = 0
  j = 0
  let result = ''
  for (let c = 0; c < text.length; c += 1) {
    i = (i + 1) % 256
    j = (j + s[i]) % 256
    ;[s[i], s[j]] = [s[j], s[i]]
    const k = s[(s[i] + s[j]) % 256]
    result += String.fromCharCode(text.charCodeAt(c) ^ k)
  }
  return result
}

function decodeV1Payload(raw: string) {
  const decoded = atob(raw.trim())
  const json = rc4(decoded, V1_KEY)
  return JSON.parse(json) as { code: number; info: string; data?: any }
}

function parseV1Payload(raw: string) {
  const trimmed = raw.trim()

  try {
    return decodeV1Payload(trimmed)
  } catch {
    try {
      return JSON.parse(trimmed) as { code: number; info: string; data?: any }
    } catch {
      const preview = trimmed.slice(0, 400)
      throw new Error(`pc-update payload parse failed: ${preview}`)
    }
  }
}

function encodeFormBody(body: Record<string, string>) {
  const params = new URLSearchParams()
  Object.entries(body).forEach(([key, value]) => params.append(key, value))
  return params.toString()
}

function extractCookie(headers: Headers) {
  const candidates = [
    headers.get('set-cookie'),
    headers.get('Set-Cookie'),
    headers.get('cookie'),
  ].filter(Boolean)

  if (!candidates.length) return ''

  const parts = candidates
    .join(',')
    .match(/[^=;,\s]+=[^;,\s]+/g)
    ?.filter((item) => !/^path=|^expires=|^domain=|^max-age=|^httponly|^secure|^samesite=/i.test(item))

  return parts?.join('; ') ?? ''
}

async function httpText(
  url: string,
  init?: {
    method?: string
    headers?: Record<string, string>
    body?: string
    timeout?: number
  },
) {
  const response = await fetch(url, {
    method: init?.method ?? 'GET',
    headers: init?.headers,
    body: init?.body,
    connectTimeout: init?.timeout ?? 12000,
  } as any)

  const text = await response.text()
  if (!response.ok) {
    throw new Error(text || `request failed: ${response.status}`)
  }
  return { response, text }
}

async function fetchLoginConfig(): Promise<LoginConfig> {
  const cached = getCachedRecord<LoginConfig>(
    BLUELAYER_LOGIN_CONFIG_CACHE_KEY,
    BLUELAYER_LOGIN_CONFIG_CACHE_TTL,
  )
  if (cached?.panels?.length) return cached
  if (loginConfigPromise) return loginConfigPromise

  const parseLoginConfig = (raw: string): LoginConfig => {
    const data = JSON.parse(raw) as LoginConfig
    const panels = Array.isArray(data.panels)
      ? data.panels.map((item) => normalizeBaseUrl(item)).filter(Boolean)
      : []

    return {
      panels,
      purchase_path: data.purchase_path || '/user/shop',
    }
  }

  const remoteConfigUrls = [
    BLUELAYER_LOGIN_CONFIG_URL,
    BLUELAYER_LOGIN_CONFIG_BACKUP_URL,
  ]

  loginConfigPromise = (async () => {
    try {
      const parsed = await Promise.any(
        remoteConfigUrls.map(async (configUrl) => {
          const { text } = await httpText(configUrl, { timeout: 6000 })
          const next = parseLoginConfig(text)
          if (!next.panels.length) {
            throw new Error('empty login config')
          }
          return next
        }),
      )
      saveCachedRecord(BLUELAYER_LOGIN_CONFIG_CACHE_KEY, parsed)
      return parsed
    } catch {
      const fallback = {
        panels: [normalizeBaseUrl(BLUELAYER_FALLBACK_PANEL_URL)],
        purchase_path: '/user/shop',
      }
      saveCachedRecord(BLUELAYER_LOGIN_CONFIG_CACHE_KEY, fallback)
      return fallback
    } finally {
      loginConfigPromise = null
    }
  })()

  return loginConfigPromise
}

type FullConfigResponse = {
  login?: LoginUiConfig
  nav?: NavItemConfig[]
  levelDesc?: Record<string, string>
}

const configCache = new Map<string, FullConfigResponse>()

async function fetchFullConfig(baseUrl: string): Promise<FullConfigResponse> {
  const safeBase = normalizeBaseUrl(baseUrl)
  if (configCache.has(safeBase)) return configCache.get(safeBase)!
  const persistedCache = getCachedRecord<Record<string, FullConfigResponse>>(
    BLUELAYER_FULL_CONFIG_CACHE_KEY,
    BLUELAYER_FULL_CONFIG_CACHE_TTL,
  )
  const persisted = persistedCache?.[safeBase]
  if (persisted) {
    configCache.set(safeBase, persisted)
    return persisted
  }
  const { text } = await httpText(`${safeBase}/v1/config`, { timeout: 6000 })
  const data = JSON.parse(text) as FullConfigResponse
  configCache.set(safeBase, data)
  saveCachedRecord(BLUELAYER_FULL_CONFIG_CACHE_KEY, {
    ...(persistedCache || {}),
    [safeBase]: data,
  })
  return data
}

async function fetchConfigSegment<T = any>(baseUrl: string, seg: keyof FullConfigResponse): Promise<T> {
  const data = await fetchFullConfig(baseUrl)
  return (data?.[seg] ?? null) as T
}

async function resolvePanel(panelIndex?: number) {
  const config = await fetchLoginConfig()
  const panels = config.panels
  const cached = getCachedRecord<ResolvedPanel>(
    BLUELAYER_PANEL_CACHE_KEY,
    BLUELAYER_PANEL_CACHE_TTL,
  )
  if (
    cached &&
    panels.includes(cached.baseUrl) &&
    (typeof panelIndex !== 'number' || cached.panelIndex === panelIndex)
  ) {
    return cached
  }
  if (panelResolvePromise) return panelResolvePromise

  panelResolvePromise = (async () => {
    const tryOrder = typeof panelIndex === 'number'
      ? [panels[panelIndex], ...panels.filter((_, index) => index !== panelIndex)]
      : panels

    try {
      const baseUrl = await Promise.any(
        tryOrder.filter(Boolean).map(async (panel) => {
          await fetchConfigSegment(panel, 'login')
          return panel
        }),
      )

      const resolved = {
        baseUrl,
        panelIndex: panels.indexOf(baseUrl),
        purchasePath: config.purchase_path || '/user/shop',
      }
      saveCachedRecord(BLUELAYER_PANEL_CACHE_KEY, resolved)
      return resolved
    } catch {
      throw new Error('\u65e0\u6cd5\u8fde\u63a5\u5230\u53ef\u7528\u9762\u677f')
    } finally {
      panelResolvePromise = null
    }
  })()

  return panelResolvePromise
}

async function v1Get(baseUrl: string, path: string, cookie?: string) {
  const { text } = await httpText(`${normalizeBaseUrl(baseUrl)}${path}`, {
    headers: cookie ? { Cookie: cookie } : undefined,
    timeout: 15000,
  })
  return parseV1Payload(text)
}

async function v1Post(
  baseUrl: string,
  path: string,
  body: Record<string, string>,
  cookie?: string,
) {
  const { response, text } = await httpText(`${normalizeBaseUrl(baseUrl)}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: encodeFormBody(body),
    timeout: 15000,
  })
  return {
    payload: parseV1Payload(text),
    cookie: extractCookie(response.headers),
  }
}

function resolveManagedSubscriptionUrl(baseUrl: string, subscriptionUrl: string) {
  const safeBase = normalizeBaseUrl(baseUrl)
  if (!subscriptionUrl) return subscriptionUrl

  try {
    const source = new URL(subscriptionUrl, `${safeBase}/`)
    const panel = new URL(safeBase)
    source.protocol = panel.protocol
    source.host = panel.host
    return source.toString()
  } catch {
    return toAbsoluteUrl(safeBase, subscriptionUrl)
  }
}

function hasPackage(userInfo?: UserInfo | null) {
  if (!userInfo) return false
  if ((userInfo.class ?? 0) <= 0) return false
  if (!userInfo.class_expire) return true
  const ts = Date.parse(String(userInfo.class_expire).replace(/-/g, '/'))
  if (Number.isNaN(ts)) return true
  return ts > Date.now()
}

async function fetchSubscriptionText(baseUrl: string, subscriptionUrl: string) {
  const managedSubscriptionUrl = resolveManagedSubscriptionUrl(baseUrl, subscriptionUrl)
  const cacheBustingUrl = `${managedSubscriptionUrl}${managedSubscriptionUrl.includes('?') ? '&' : '?'}t=${Date.now()}`
  const { text } = await httpText(cacheBustingUrl, {
    headers: {
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    },
    timeout: 30000,
  })

  if (!/proxy-groups:|proxies:/i.test(text)) {
    throw new Error('\u8ba2\u9605\u5185\u5bb9\u4e0d\u5b8c\u6574')
  }

  return text
}

async function clearExtraManagedProfiles() {
  const profiles = await getProfiles()
  const managed = (profiles.items || []).filter(
    (item) => item.desc === BLUELAYER_PROFILE_DESC || item.name === BLUELAYER_PROFILE_NAME,
  )
  if (managed.length <= 1) return
  for (const extra of managed.slice(1)) {
    if (extra.uid) {
      try {
        await patchProfile(extra.uid, { chain: [] } as any)
      } catch {}
    }
  }
}

async function getManagedProfile() {
  const profiles = await getProfiles()
  return profiles.items?.find(
    (item) => item.desc === BLUELAYER_PROFILE_DESC || item.name === BLUELAYER_PROFILE_NAME,
  )
}

async function shouldRefreshManagedProfile(baseUrl: string, subscriptionUrl: string) {
  const cache = getManagedSubscriptionCache()
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)
  const normalizedSubscriptionUrl = resolveManagedSubscriptionUrl(baseUrl, subscriptionUrl)

  if (!cache) return true
  if (!cache.fetchedAt || Date.now() - cache.fetchedAt >= BLUELAYER_SUBSCRIPTION_CACHE_TTL) {
    return true
  }
  if (cache.baseUrl !== normalizedBaseUrl) return true
  if (cache.subscriptionUrl !== normalizedSubscriptionUrl) return true

  const managed = await getManagedProfile()
  return !managed?.uid
}

async function clearManagedProfiles() {
  const profiles = await getProfiles()
  const managed = (profiles.items || []).filter(
    (item) => item.desc === BLUELAYER_PROFILE_DESC || item.name === BLUELAYER_PROFILE_NAME,
  )

  for (const item of managed) {
    if (!item.uid) continue
    try {
      await deleteProfile(item.uid)
    } catch {
      // continue deleting remaining managed profiles
    }
  }

  clearManagedSubscriptionCache()

  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['getProfiles'] }),
    queryClient.invalidateQueries({ queryKey: ['getProxies'] }),
    queryClient.invalidateQueries({ queryKey: ['getClashConfig'] }),
  ])
}

async function waitForProxyReady() {
  for (let index = 0; index < 4; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 600))
    try {
      const proxyData = await calcuProxies()
      const hasGroups = (proxyData.groups?.length ?? 0) > 0
      const hasGlobal = (proxyData.global?.all?.length ?? 0) > 0
      if (hasGroups || hasGlobal) return true
    } catch {
      // retry
    }
  }
  return false
}

async function ensureManagedProfile(baseUrl: string, subscriptionUrl: string) {
  const text = await fetchSubscriptionText(baseUrl, subscriptionUrl)
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)
  const normalizedSubscriptionUrl = resolveManagedSubscriptionUrl(baseUrl, subscriptionUrl)

  const profiles = await getProfiles()
  let managed = profiles.items?.find(
    (item) => item.desc === BLUELAYER_PROFILE_DESC || item.name === BLUELAYER_PROFILE_NAME,
  )

  if (managed?.uid) {
    await saveProfileFile(managed.uid, text)
    await patchProfile(managed.uid, {
      name: BLUELAYER_PROFILE_NAME,
      desc: BLUELAYER_PROFILE_DESC,
      url: '',
      home: '',
    } as any)
  } else {
    await createProfile(
      {
        type: 'local',
        name: BLUELAYER_PROFILE_NAME,
        desc: BLUELAYER_PROFILE_DESC,
        option: {
          with_proxy: false,
          self_proxy: false,
          allow_auto_update: false,
        },
      } as any,
      text,
    )
  }

  const profilesAfterCreate = await getProfiles()
  managed = profilesAfterCreate.items?.find(
    (item) => item.desc === BLUELAYER_PROFILE_DESC || item.name === BLUELAYER_PROFILE_NAME,
  )

  if (!managed?.uid) {
    throw new Error('鍒涘缓 Bluelayer 璁㈤槄澶辫触')
  }

  await clearExtraManagedProfiles()
  await patchProfilesConfig({ current: managed.uid } as any)
  await enhanceProfiles()

  const proxyReady = await waitForProxyReady()
  if (!proxyReady) {
    throw new Error('绾胯矾灏氭湭鍔犺浇瀹屾垚锛岃绋嶅悗閲嶈瘯')
  }

  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['getProfiles'] }),
    queryClient.invalidateQueries({ queryKey: ['getProxies'] }),
    queryClient.invalidateQueries({ queryKey: ['getClashConfig'] }),
  ])

  saveManagedSubscriptionCache({
    fetchedAt: Date.now(),
    baseUrl: normalizedBaseUrl,
    subscriptionUrl: normalizedSubscriptionUrl,
  })

  return managed.uid
}

async function ensureManagedProfileWithRetry(
  baseUrl: string,
  subscriptionUrl: string,
) {
  let lastError: unknown = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await ensureManagedProfile(baseUrl, subscriptionUrl)
    } catch (error) {
      lastError = error
      if (attempt < 1) {
        await new Promise((resolve) => setTimeout(resolve, 800))
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('璁㈤槄鍚屾澶辫触锛岃绋嶅悗閲嶈瘯')
}

async function buildRuntimeState(session: StoredSession) {
  const { baseUrl, purchasePath } = await resolvePanel(session.panelIndex)
  const [loginUi, nav] = await Promise.all([
    fetchConfigSegment<LoginUiConfig>(baseUrl, 'login').catch(() => null),
    fetchConfigSegment<NavItemConfig[]>(baseUrl, 'nav').catch(() => null),
  ])

  return {
    baseUrl,
    purchaseUrl: toAbsoluteUrl(baseUrl, purchasePath),
    supportUrl:
      nav?.find((item) => (item.desc || '').includes('瀹㈡湇'))?.link
        ? toAbsoluteUrl(
            baseUrl,
            nav?.find((item) => (item.desc || '').includes('瀹㈡湇'))?.link,
          )
        : '',
    loginUi,
    nav,
  }
}

export async function bootstrapBluelayer() {
  if (bootstrapPromise) return bootstrapPromise

  bootstrapPromise = (async () => {
    try {
      setState({ checking: true })
      const stored = getStoredSession()
      if (!stored || Date.now() - stored.createdAt > BLUELAYER_SESSION_MAX_AGE) {
        saveStoredSession(null)
        const cachedPanel = getCachedRecord<ResolvedPanel>(
          BLUELAYER_PANEL_CACHE_KEY,
          BLUELAYER_PANEL_CACHE_TTL,
        )
        const cachedLoginUi =
          cachedPanel?.baseUrl
            ? await fetchConfigSegment<LoginUiConfig>(cachedPanel.baseUrl, 'login').catch(() => null)
            : null
        setState({
          ready: true,
          checking: false,
          authenticated: false,
          session: null,
          loginUi: cachedLoginUi,
        })
        void resolvePanel()
          .then(({ baseUrl }) =>
            fetchConfigSegment<LoginUiConfig>(baseUrl, 'login').catch(() => null),
          )
          .then((loginUi) => {
            if (loginUi) setState({ loginUi })
          })
          .catch(() => null)
        return
      }

      if (!stored.cookie) {
        saveStoredSession(null)
        setState({ ready: true, checking: false, authenticated: false, session: null })
        return
      }

      const { baseUrl } = await resolvePanel(stored.panelIndex)
      const userResp = await v1Get(baseUrl, '/v1/userinfo', stored.cookie)
      if (userResp.code !== 200 || !userResp.data) {
      throw new Error(userResp.info || '\u4f1a\u8bdd\u5df2\u5931\u6548')
      }

      const nextSession: StoredSession = {
        ...stored,
        userInfo: userResp.data as UserInfo,
      }
      if (hasPackage(nextSession.userInfo) && nextSession.userInfo.pc_sub) {
        if (await shouldRefreshManagedProfile(baseUrl, nextSession.userInfo.pc_sub)) {
          await ensureManagedProfileWithRetry(baseUrl, nextSession.userInfo.pc_sub)
        }
      } else {
        await clearManagedProfiles().catch(() => null)
      }
      saveStoredSession(nextSession)
      const runtimeState = await buildRuntimeState(nextSession)
      setState({
        ready: true,
        checking: false,
        authenticated: true,
        session: nextSession,
        loginUi: runtimeState.loginUi,
        nav: runtimeState.nav,
      })
    } catch {
      saveStoredSession(null)
      setState({ ready: true, checking: false, authenticated: false, session: null })
    } finally {
      bootstrapPromise = null
    }
  })()

  return bootstrapPromise
}

export async function loginBluelayer(username: string, password: string) {
  setState({ checking: true })
  try {
    const { baseUrl, panelIndex } = await resolvePanel()
    const [loginUi, nav] = await Promise.all([
      fetchConfigSegment<LoginUiConfig>(baseUrl, 'login').catch(() => null),
      fetchConfigSegment<NavItemConfig[]>(baseUrl, 'nav').catch(() => null),
    ])

    const result = await v1Post(baseUrl, '/v1/login', { username, password })
    if (result.payload.code !== 200 || !result.payload.data) {
      throw new Error(result.payload.info || '鐧诲綍澶辫触')
    }

    const updateLogin = await v1Post(BLUELAYER_UPDATE_BASE_URL, '/v1/login', {
      username,
      password,
    }).catch(() => null)

    const userInfo = result.payload.data as UserInfo
    if (hasPackage(userInfo) && userInfo.pc_sub) {
      await ensureManagedProfileWithRetry(baseUrl, userInfo.pc_sub)
    } else {
      await clearManagedProfiles().catch(() => null)
    }

    const session: StoredSession = {
      username,
      cookie: result.cookie,
      updateCookie: updateLogin?.cookie || '',
      panelIndex,
      createdAt: Date.now(),
      userInfo,
    }
    saveStoredSession(session)
    setState({
      ready: true,
      checking: false,
      authenticated: true,
      session,
      loginUi,
      nav,
    })
    return session
  } catch (error) {
    setState({ checking: false, ready: true })
    throw error
  }
}

export async function refreshBluelayerSubscription() {
  if (subscriptionRefreshPromise) return subscriptionRefreshPromise

  const current = getStoredSession()
  if (!current) throw new Error('\u672a\u767b\u5f55')
  subscriptionRefreshPromise = (async () => {
    try {
      const { baseUrl } = await resolvePanel(current.panelIndex)
      const userResp = await v1Get(baseUrl, '/v1/userinfo', current.cookie)
      if (userResp.code !== 200 || !userResp.data) {
        throw new Error(userResp.info || '鐢ㄦ埛淇℃伅鑾峰彇澶辫触')
      }
      const nextSession = { ...current, userInfo: userResp.data as UserInfo }
      saveStoredSession(nextSession)
      if (hasPackage(nextSession.userInfo) && nextSession.userInfo.pc_sub) {
        clearManagedSubscriptionCache()
        await ensureManagedProfileWithRetry(baseUrl, nextSession.userInfo.pc_sub)
      } else {
        await clearManagedProfiles().catch(() => null)
      }
      setState({ session: nextSession, authenticated: true, ready: true })
      return nextSession
    } finally {
      subscriptionRefreshPromise = null
    }
  })()

  return subscriptionRefreshPromise
}

export async function logoutBluelayer() {
  const current = getStoredSession()
  try {
    if (current?.cookie) {
      const { baseUrl } = await resolvePanel(current.panelIndex)
      await v1Get(baseUrl, '/v1/logout', current.cookie).catch(() => null)
    }
    if (current?.updateCookie) {
      await v1Get(BLUELAYER_UPDATE_BASE_URL, '/v1/logout', current.updateCookie).catch(
        () => null,
      )
    }
  } finally {
    await clearManagedProfiles().catch(() => null)
    saveStoredSession(null)
    resetState()
    setState({ ready: true })
  }
}

export async function openPurchasePage() {
  const current = getStoredSession()
  const resolved = await resolvePanel(current?.panelIndex)
  const loginConfig = await fetchLoginConfig()
  const targetUrl = toAbsoluteUrl(
    resolved.baseUrl,
    loginConfig.purchase_path || '/user/shop',
  )

  await openBluelayerPanelWindow(
    targetUrl,
    '\u0042\u006c\u0075\u0065\u006c\u0061\u0079\u0065\u0072 \u5957\u9910\u4e2d\u5fc3',
    current?.cookie,
  )
}

export async function openRechargePage() {
  const current = getStoredSession()
  const resolved = await resolvePanel(current?.panelIndex)
  const targetUrl = toAbsoluteUrl(resolved.baseUrl, '/user/code')

  await openBluelayerPanelWindow(
    targetUrl,
    '\u0042\u006c\u0075\u0065\u006c\u0061\u0079\u0065\u0072 \u4f59\u989d\u5145\u503c',
    current?.cookie,
  )
}

export async function openForgotPasswordPage() {
  const current = getStoredSession()
  const resolved = await resolvePanel(current?.panelIndex)
  await openBluelayerPanelWindow(
    toAbsoluteUrl(resolved.baseUrl, '/password/reset'),
    '\u0042\u006c\u0075\u0065\u006c\u0061\u0079\u0065\u0072 \u627e\u56de\u5bc6\u7801',
  )
}

export async function openRegisterPage() {
  const current = getStoredSession()
  const resolved = await resolvePanel(current?.panelIndex)
  await openBluelayerPanelWindow(
    toAbsoluteUrl(resolved.baseUrl, '/auth/register'),
    '\u0042\u006c\u0075\u0065\u006c\u0061\u0079\u0065\u0072 \u6ce8\u518c',
  )
}

export async function openSupportPage() {
  const current = getStoredSession()
  const { baseUrl } = await resolvePanel(current?.panelIndex)
  const nav = await fetchConfigSegment<NavItemConfig[]>(baseUrl, 'nav').catch(() => [])
  const support = nav.find((item) => (item.desc || '').includes('\u5ba2\u670d'))?.link
  const fallbackUrl = toAbsoluteUrl(baseUrl, '/user/shop')
  const targetUrl = toAbsoluteUrl(baseUrl, support || fallbackUrl)
  await openBluelayerPanelWindow(
    targetUrl,
    '\u0042\u006c\u0075\u0065\u006c\u0061\u0079\u0065\u0072 \u5ba2\u670d\u4e2d\u5fc3',
    current?.cookie,
  )
}

export async function openInvitePage() {
  const current = getStoredSession()
  const { baseUrl } = await resolvePanel(current?.panelIndex)
  const targetUrl = toAbsoluteUrl(baseUrl, '/user/invite')

  await openBluelayerPanelWindow(
    targetUrl,
    '\u0042\u006c\u0075\u0065\u006c\u0061\u0079\u0065\u0072 \u9080\u8bf7\u8fd4\u5229',
    current?.cookie,
  )
}

export async function fetchPcAlert() {
  const current = getStoredSession()
  if (!current?.cookie) return null
  const { baseUrl } = await resolvePanel(current.panelIndex)
  const payload = await v1Get(baseUrl, '/v1/pc-alert', current.cookie).catch(() => null)
  if (!payload || payload.code !== 200 || !payload.data?.show) return null

  const data = payload.data as { title?: string; content?: string; show?: boolean }
  const hash = `${data.title || ''}::${data.content || ''}`
  return {
    title: data.title || '鍏憡',
    content: data.content || '',
    hash,
  }
}

export async function fetchPcUpdateEnvelope(): Promise<BluelayerPcUpdateEnvelope | null> {
  const current = getStoredSession()
  if (!current) return null

  const { baseUrl } = await resolvePanel(current.panelIndex)
  const payload = await v1Get(
    baseUrl,
    `/v1/pc-update?curVersion=${encodeURIComponent(appVersion)}`,
    current.cookie,
  )

  const hasExplicitCode = typeof payload.code === 'number'
  const hasWrappedData = payload.data !== undefined
  const normalizedData = hasWrappedData ? payload.data : payload

  return {
    baseUrl,
    payload: {
      code: hasExplicitCode ? payload.code ?? 0 : 200,
      info: payload.info ?? '',
      data: normalizedData,
    },
  }
}

export function dismissPcAlert(hash: string) {
  void hash
}

export function useBluelayerState() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => state,
    () => state,
  )
}

export function getBluelayerState() {
  return state
}

export function getBluelayerUserInfo() {
  return state.session?.userInfo || null
}

export function canUseBluelayer(session?: StoredSession | null) {
  return hasPackage(session?.userInfo)
}
