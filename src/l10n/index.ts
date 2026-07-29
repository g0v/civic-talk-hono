import { computed, inject, ref, type App, type InjectionKey, type Ref } from 'vue'
import { messages as zhTW } from './zh-TW'
import { messages as en } from './en'
import type { MessageKey } from './zh-TW'

export type Locale = 'zh-TW' | 'en'

const catalogs: Record<Locale, Record<MessageKey, string>> = {
  'zh-TW': zhTW,
  en,
}

export const LOCALE_KEY: InjectionKey<Ref<Locale>> = Symbol('civic-locale')

const STORAGE_KEY = 'civic_lang'

/** 將舊站 'zh'/'en' 與新碼 'zh-TW'/'en' 正規化 */
export function normalizeLocale(raw: string | null | undefined): Locale {
  if (raw === 'en') return 'en'
  if (raw === 'zh' || raw === 'zh-TW') return 'zh-TW'
  return 'zh-TW'
}

export function readStoredLocale(): Locale {
  if (typeof window === 'undefined') return 'zh-TW'
  try {
    return normalizeLocale(window.localStorage.getItem(STORAGE_KEY))
  } catch {
    return 'zh-TW'
  }
}

export function persistLocale(locale: Locale): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, locale === 'zh-TW' ? 'zh' : 'en')
  } catch {
    /* ignore */
  }
}

export function createI18n(initial: Locale = 'zh-TW') {
  const locale = ref<Locale>(initial)

  function t(key: MessageKey, vars?: Record<string, string | number>): string {
    const table = catalogs[locale.value] ?? catalogs['zh-TW']
    let text = table[key] ?? catalogs['zh-TW'][key] ?? String(key)
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        text = text.replaceAll(`{${k}}`, String(v))
      }
    }
    return text
  }

  function setLocale(next: Locale) {
    locale.value = next
    persistLocale(next)
  }

  function toggleLocale() {
    setLocale(locale.value === 'zh-TW' ? 'en' : 'zh-TW')
  }

  return { locale, t, setLocale, toggleLocale }
}

export type I18nApi = ReturnType<typeof createI18n>

export function provideI18n(app: App, initial: Locale = 'zh-TW'): I18nApi {
  const api = createI18n(initial)
  app.provide(LOCALE_KEY, api.locale)
  app.provide('civic-i18n', api)
  return api
}

export function useI18n(): I18nApi {
  const injected = inject<I18nApi>('civic-i18n')
  if (injected) return injected
  // SSR / 測試後備：不共享跨請求狀態
  return createI18n('zh-TW')
}

export function useLocaleLabel() {
  const { locale } = useI18n()
  return computed(() => (locale.value === 'zh-TW' ? 'EN' : '中文'))
}

export function formatDate(iso: string | null | undefined, locale: Locale): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(locale === 'zh-TW' ? 'zh-TW' : 'en-US')
}
