import zhCn from 'element-plus/es/locale/lang/zh-cn'
import { createI18n } from 'vue-i18n'

export type AppLocale = 'zh-CN' | 'en-US'

export const LOCALE_COOKIE = 'x-gde-locale'

function readCookie(name: string): string | undefined {
  const prefix = encodeURIComponent(name) + '='
  return document.cookie
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith(prefix))
    ?.slice(prefix.length)
}

export function resolveInitialLocale(cookie = readCookie(LOCALE_COOKIE)): AppLocale {
  return cookie === 'en_US' ? 'en-US' : 'zh-CN'
}

interface LocaleTree { [key: string]: string | LocaleTree }
type JsonModule = { default: LocaleTree }

function loadLocaleFolder(modules: Record<string, JsonModule>): LocaleTree {
  return Object.fromEntries(
    Object.entries(modules).map(([file, module]) => {
      const fileName = file.split('/').at(-1)?.replace(/\.json$/u, '')
      if (!fileName) throw new Error('Invalid locale file path: ' + file)
      return [fileName, module.default]
    }),
  )
}

const locale = resolveInitialLocale()
const messages = {
  'zh-CN': loadLocaleFolder(import.meta.glob<JsonModule>('../locales/zh-cn/*.json', { eager: true })),
  'en-US': loadLocaleFolder(import.meta.glob<JsonModule>('../locales/en-us/*.json', { eager: true })),
}

document.documentElement.lang = locale

export const i18n = createI18n({
  legacy: false,
  locale,          // 默认中文
  fallbackLocale: 'zh-CN',
  messages,
})

export const elementLocale = zhCn // Element Plus 固定 zh-cn locale(词条采集以中文为准)
