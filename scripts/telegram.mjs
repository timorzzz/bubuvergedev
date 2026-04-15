import { readFileSync } from 'fs'

import axios from 'axios'

import { log_error, log_info, log_success } from './utils.mjs'

const CHAT_ID_RELEASE = '@clash_verge_re'
const CHAT_ID_TEST = '@vergetest'
const GITHUB_REPOSITORY =
  process.env.RELEASE_REPOSITORY ||
  process.env.GITHUB_REPOSITORY ||
  'your-account/your-repo'
const GITHUB_RELEASE_BASE = `https://github.com/${GITHUB_REPOSITORY}/releases`

async function sendTelegramNotification() {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    throw new Error('TELEGRAM_BOT_TOKEN is required')
  }

  const version =
    process.env.VERSION ||
    (() => {
      const pkg = readFileSync('package.json', 'utf-8')
      return JSON.parse(pkg).version
    })()

  const downloadUrl =
    process.env.DOWNLOAD_URL || `${GITHUB_RELEASE_BASE}/download/v${version}`

  const isAutobuild =
    process.env.BUILD_TYPE === 'autobuild' || version.includes('autobuild')
  const chatId = isAutobuild ? CHAT_ID_TEST : CHAT_ID_RELEASE
  const buildType = isAutobuild ? 'Autobuild' : 'Release'

  log_info(`Preparing Telegram notification for ${buildType} ${version}`)
  log_info(`Target channel: ${chatId}`)
  log_info(`Download URL: ${downloadUrl}`)

  let releaseContent = ''
  try {
    releaseContent = readFileSync('release.txt', 'utf-8')
    log_info('Successfully loaded release.txt')
  } catch (error) {
    log_error('Failed to read release.txt, using fallback text', error)
    releaseContent = 'More new features are now supported. Check release page for details.'
  }

  function convertMarkdownToTelegramHTML(content) {
    const cleanHeading = (text) =>
      text
        .replace(/<\/?[^>]+>/g, '')
        .replace(/\*\*/g, '')
        .trim()

    return content
      .split('\n')
      .map((line) => {
        if (line.trim().length === 0) {
          return ''
        }
        if (line.startsWith('## ')) {
          return `<b>${cleanHeading(line.replace('## ', ''))}</b>`
        }
        if (line.startsWith('### ')) {
          return `<b>${cleanHeading(line.replace('### ', ''))}</b>`
        }
        if (line.startsWith('#### ')) {
          return `<b>${cleanHeading(line.replace('#### ', ''))}</b>`
        }

        let processedLine = line.replace(
          /\[([^\]]+)\]\(([^)]+)\)/g,
          (match, text, url) => {
            const encodedUrl = encodeURI(url)
            return `<a href="${encodedUrl}">${text}</a>`
          },
        )
        processedLine = processedLine.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
        return processedLine
      })
      .join('\n')
  }

  function normalizeDetailsTags(content) {
    return content
      .replace(
        /<summary>\s*<strong>\s*(.*?)\s*<\/strong>\s*<\/summary>/g,
        '\n<b>$1</b>\n',
      )
      .replace(/<summary>\s*(.*?)\s*<\/summary>/g, '\n<b>$1</b>\n')
      .replace(/<\/?details>/g, '')
      .replace(/<\/?strong>/g, (m) => (m === '</strong>' ? '</b>' : '<b>'))
      .replace(/<br\s*\/?>/g, '\n')
  }

  function sanitizeTelegramHTML(content) {
    const allowedTags =
      /^\/?(b|strong|i|em|u|ins|s|strike|del|a|code|pre|blockquote|tg-spoiler|tg-emoji)(\s|>|$)/i
    return content.replace(/<\/?[^>]*>/g, (tag) => {
      const inner = tag.replace(/^<\/?/, '').replace(/>$/, '')
      if (allowedTags.test(inner) || allowedTags.test(tag.slice(1))) {
        return tag
      }
      return tag.replace(/</g, '&lt;').replace(/>/g, '&gt;')
    })
  }

  releaseContent = normalizeDetailsTags(releaseContent)
  const formattedContent = sanitizeTelegramHTML(
    convertMarkdownToTelegramHTML(releaseContent),
  )

  const releaseTitle = isAutobuild ? 'Autobuild 发布' : '正式发布'
  const encodedVersion = encodeURIComponent(version)
  const releaseTag = isAutobuild ? 'autobuild' : `v${version}`
  const content = `<b>🎉 <a href="${GITHUB_RELEASE_BASE}/tag/${releaseTag}">Clash Verge Rev v${version}</a> ${releaseTitle}</b>\n\n${formattedContent}`

  try {
    await axios.post(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        chat_id: chatId,
        text: content,
        link_preview_options: {
          is_disabled: false,
          url: `${GITHUB_RELEASE_BASE}/tag/v${encodedVersion}`,
          prefer_large_media: true,
        },
        parse_mode: 'HTML',
      },
    )
    log_success(`Telegram notification sent to ${chatId}`)
  } catch (error) {
    log_error(
      `Failed to send Telegram notification to ${chatId}:`,
      error.response?.data || error.message,
      error,
    )
    process.exit(1)
  }
}

sendTelegramNotification().catch((error) => {
  log_error('Script execution failed:', error)
  process.exit(1)
})
