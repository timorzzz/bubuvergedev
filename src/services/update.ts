import { version as currentVersion } from '@root/package.json'

import {
  fetchPcUpdateEnvelope,
  type BluelayerPcUpdateEnvelope,
} from '@/services/bluelayer'
import getSystem from '@/utils/get-system'

export type CheckOptions = Record<string, never>

export type Update = {
  version: string
  body: string
  date: string
  available: boolean
  checkFailed?: boolean
  downloadUrl?: string
  message?: string
  currentVersion?: string
  rawJson?: Record<string, unknown>
}

type UpdatePayload = Record<string, unknown>

const SYSTEM = getSystem()

const normalizeUrl = (baseUrl: string, value?: string | null) => {
  if (!value) return ''
  if (/^https?:\/\//i.test(value)) return value
  return `${baseUrl.replace(/\/+$/, '')}${value.startsWith('/') ? value : `/${value}`}`
}

const asString = (value: unknown) => {
  if (typeof value !== 'string') return null
  const next = value.trim()
  return next || null
}

const asObject = (value: unknown): UpdatePayload | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as UpdatePayload
}

const pickString = (source: UpdatePayload | null, keys: string[]) => {
  if (!source) return null
  for (const key of keys) {
    const value = asString(source[key])
    if (value) return value
  }
  return null
}

const pickBoolean = (source: UpdatePayload | null, keys: string[]) => {
  if (!source) return null
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'boolean') return value
    if (typeof value === 'number') return value !== 0
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase()
      if (['true', '1', 'yes'].includes(normalized)) return true
      if (['false', '0', 'no'].includes(normalized)) return false
    }
  }
  return null
}

const VERSION_KEY_PATTERN = /(version|ver|tag)/i

export const normalizeVersion = (input: string | null | undefined) =>
  typeof input === 'string' ? input.trim().replace(/^v/i, '') || null : null

export const ensureSemver = (input: string | null | undefined) =>
  normalizeVersion(input)

export const extractSemver = (input: string | null | undefined) =>
  normalizeVersion(input)

export const splitVersion = (version: string | null) => {
  const normalized = normalizeVersion(version)
  if (!normalized) return null

  const parts = normalized.split(/[.-]/).map((part) => {
    const numeric = Number.parseInt(part, 10)
    return Number.isFinite(numeric) ? numeric : 0
  })

  while (parts.length < 3) {
    parts.push(0)
  }

  return parts
}

export const compareVersions = (a: string | null, b: string | null) => {
  const left = splitVersion(a)
  const right = splitVersion(b)

  if (!left || !right) return null

  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const leftValue = left[index] ?? 0
    const rightValue = right[index] ?? 0
    if (leftValue > rightValue) return 1
    if (leftValue < rightValue) return -1
  }

  return 0
}

export const resolveRemoteVersion = (update: Update) =>
  normalizeVersion(update.version)

const extractVersionFromText = (input?: string | null) => {
  if (!input) return null
  const matched = input.match(/(?:^|[^0-9])v?(\d+\.\d+\.\d+)/i)
  return normalizeVersion(matched?.[1])
}

const findVersionInObject = (source: UpdatePayload | null) => {
  if (!source) return null

  for (const [key, value] of Object.entries(source)) {
    if (typeof value !== 'string') continue
    if (!VERSION_KEY_PATTERN.test(key)) continue
    const extracted = extractVersionFromText(value)
    if (extracted) return extracted
  }

  return null
}

const resolveDownloadUrl = (baseUrl: string, source: UpdatePayload | null) => {
  if (!source) return ''

  const downloads = asObject(source.downloads)
  const nestedDownloadCandidates = [
    asObject(downloads?.windows),
    asObject(downloads?.win),
    asObject(downloads?.macos),
    asObject(downloads?.darwin),
    asObject(downloads?.linux),
    asObject(downloads?.default),
  ].filter(Boolean) as UpdatePayload[]
  const systemKeys =
    SYSTEM === 'windows'
      ? ['windows_url', 'win_url', 'windows', 'win', 'pc_url', 'pc']
      : SYSTEM === 'macos'
        ? ['mac_url', 'macos_url', 'darwin_url', 'macos', 'darwin', 'mac']
        : SYSTEM === 'linux'
          ? ['linux_url', 'linux']
          : []

  const directUrl = pickString(source, [
    ...systemKeys,
    'download_url',
    'downloadUrl',
    'url',
    'link',
    'download',
  ])
  if (directUrl) return normalizeUrl(baseUrl, directUrl)

  const nestedUrl = pickString(downloads, [
    ...systemKeys,
    'default',
    'all',
    'url',
    'link',
  ])
  if (nestedUrl) return normalizeUrl(baseUrl, nestedUrl)

  for (const item of nestedDownloadCandidates) {
    const itemUrl = pickString(item, ['url', 'link', 'download_url', 'downloadUrl'])
    if (itemUrl) return normalizeUrl(baseUrl, itemUrl)
  }

  return ''
}

const parseEnvelope = (
  envelope: BluelayerPcUpdateEnvelope,
): Update | null => {
  if (envelope.payload.code !== 200) {
    return {
      version: normalizeVersion(currentVersion) ?? currentVersion,
      body: '',
      date: '',
      available: false,
      checkFailed: true,
      downloadUrl: '',
      message:
        envelope.payload.info ||
        '\u68c0\u67e5\u66f4\u65b0\u5931\u8d25',
      rawJson: asObject(envelope.payload.data) ?? undefined,
    }
  }

  const root = asObject(envelope.payload.data)
  const candidates = [
    root,
    asObject(root?.data),
    asObject(root?.update),
    asObject(root?.latest),
  ].filter(Boolean) as UpdatePayload[]

  const data =
    candidates.find((item) =>
      Boolean(
        pickString(item, [
          'version_code',
          'version',
          'new_version',
          'latest_version',
          'latestVersion',
          'tag',
          'tag_name',
        ]),
      ),
    ) ?? root

  if (!data) {
    return {
      version: normalizeVersion(currentVersion) ?? currentVersion,
      body: '',
      date: '',
      available: false,
      checkFailed: true,
      downloadUrl: '',
      message: `pc-update missing data payload: ${JSON.stringify(envelope.payload.data ?? null)}`,
      rawJson: asObject(envelope.payload.data) ?? undefined,
    }
  }

  const version =
    pickString(data, [
      'version_code',
      'update_version_code',
      'pc_update_version_code',
      'pcUpdateVersionCode',
      'pc_update_version',
      'pcUpdateVersion',
      'version',
      'ver',
      'new_version',
      'newVersion',
      'latest_version',
      'latestVersion',
      'app_version',
      'appVersion',
      'client_version',
      'clientVersion',
      'pc_version',
      'pcVersion',
      'win_version',
      'winVersion',
      'windows_version',
      'windowsVersion',
      'tag',
      'tag_name',
    ]) ?? ''

  const body =
    pickString(data, [
      'desc',
      'description',
      'content',
      'body',
      'note',
      'notes',
      'changelog',
      'update_log',
      'updateLog',
    ]) ?? ''

  const date =
    pickString(data, ['date', 'created_at', 'published_at', 'updated_at']) ?? ''

  const downloadUrl = resolveDownloadUrl(envelope.baseUrl, data)
  const updateFlag =
    pickBoolean(data, ['update', 'has_update', 'need_update', 'available']) ??
    null
  const current = normalizeVersion(currentVersion)
  const remote = normalizeVersion(version) || findVersionInObject(data) || null
  const compareResult = compareVersions(remote, current)
  const available =
    typeof updateFlag === 'boolean'
      ? updateFlag
      : compareResult === 1

  return {
    version: remote ?? current ?? currentVersion,
    body,
    date,
    downloadUrl,
    available,
    checkFailed: false,
    message: envelope.payload.info || '',
    currentVersion: current ?? currentVersion,
    rawJson: data,
  }
}

export const checkUpdateSafe = async (
  _options?: CheckOptions,
): Promise<Update | null> => {
  try {
    const envelope = await fetchPcUpdateEnvelope()
    if (!envelope) return null
    return parseEnvelope(envelope)
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : JSON.stringify(error)

    return {
      version: normalizeVersion(currentVersion) ?? currentVersion,
      body: '',
      date: '',
      available: false,
      checkFailed: true,
      downloadUrl: '',
      message,
      currentVersion: normalizeVersion(currentVersion) ?? currentVersion,
    }
  }
}
