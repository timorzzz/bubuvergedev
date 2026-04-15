import getSystem from '@/utils/get-system'
const OS = getSystem()

// default theme setting
export const defaultTheme = {
  primary_color: '#ff9f1c',
  secondary_color: '#ffd166',
  primary_text: '#15171a',
  secondary_text: '#67707d',
  info_color: '#4da3ff',
  error_color: '#ff5d5d',
  warning_color: '#ffb703',
  success_color: '#34c759',
  background_color: '#f3efe7',
  font_family: `-apple-system, BlinkMacSystemFont,"Microsoft YaHei UI", "Microsoft YaHei", Roboto, "Helvetica Neue", Arial, sans-serif, "Apple Color Emoji"${
    OS === 'windows' ? ', twemoji mozilla' : ''
  }`,
}

// dark mode
export const defaultDarkTheme = {
  ...defaultTheme,
  primary_color: '#ff9f1c',
  secondary_color: '#ffd166',
  primary_text: '#FFFFFF',
  background_color: '#0b0b0d',
  secondary_text: '#a6adbb',
  info_color: '#4da3ff',
  error_color: '#ff6b6b',
  warning_color: '#ffb703',
  success_color: '#30d158',
}
