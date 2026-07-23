import en from 'element-plus/es/locale/lang/en'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import { createI18n } from 'vue-i18n'

export const LOCALE_COOKIE = 'x-gde-locale'
export type AppLocale = 'zh-CN' | 'en-US'

function readCookie(name: string): string | undefined {
  const prefix = `${encodeURIComponent(name)}=`
  return document.cookie
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith(prefix))
    ?.slice(prefix.length)
}

export function resolveInitialLocale(cookie = readCookie(LOCALE_COOKIE)): AppLocale {
  return cookie === 'zh_CN' ? 'zh-CN' : 'en-US'
}

interface LocaleTree { [key: string]: string | LocaleTree }
type JsonModule = { default: LocaleTree }

function loadLocaleFolder(modules: Record<string, JsonModule>): LocaleTree {
  return Object.fromEntries(
    Object.entries(modules).map(([file, module]) => {
      const fileName = file.split('/').at(-1)?.replace(/\.json$/u, '')
      if (!fileName) throw new Error(`Invalid locale file path: ${file}`)
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
  locale,
  fallbackLocale: 'en-US',
  messages,
})

export const elementLocale = locale === 'zh-CN' ? zhCn : en
