import { createI18n, type LocaleMessages } from 'vue-i18n'

type LocaleKey = 'zh-CN' | 'en-US'

function loadMessages(locale: 'zh-cn' | 'en-us'): LocaleMessages<LocaleKey> {
  const modules =
    locale === 'zh-cn'
      ? import.meta.glob<{ default: Record<string, unknown> }>('./zh-cn/*.json', { eager: true })
      : import.meta.glob<{ default: Record<string, unknown> }>('./en-us/*.json', { eager: true })
  const messages = {} as LocaleMessages<LocaleKey>
  for (const [path, mod] of Object.entries(modules)) {
    const fileName = path.split('/').pop()!.replace(/\.json$/, '')
    ;(messages as unknown as Record<string, unknown>)[fileName] = mod.default
  }
  return messages
}

export const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'zh-CN',
  messages: {
    'zh-CN': loadMessages('zh-cn'),
    'en-US': loadMessages('en-us'),
  },
})

export function switchLocale(locale: LocaleKey): void {
  i18n.global.locale.value = locale
  document.documentElement.lang = locale
}
