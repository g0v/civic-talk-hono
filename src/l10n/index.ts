import { inject, ref, type App, type InjectionKey, type Ref } from 'vue'
import { messages as zhTW } from './zh-TW'
import { messages as en } from './en'
import { messages as ja } from './ja'
import { messages as de } from './de'
import type { MessageKey } from './zh-TW'

export const supportedLocales = [
  { code: 'zh-TW', labelKey: 'language_zh_tw' },
  { code: 'en', labelKey: 'language_en' },
  { code: 'ja', labelKey: 'language_ja' },
  { code: 'de', labelKey: 'language_de' },
] as const

export type Locale = (typeof supportedLocales)[number]['code']

const catalogs: Record<Locale, Record<MessageKey, string>> = {
  'zh-TW': zhTW,
  en,
  ja,
  de,
}

export const LOCALE_KEY: InjectionKey<Ref<Locale>> = Symbol('civic-locale')

const STORAGE_KEY = 'civic_lang'

/** 保留舊站 'zh' 偏好；其餘使用標準語言代碼。 */
export function normalizeLocale(raw: string | null | undefined): Locale {
  return supportedLocales.find(({ code }) => code === raw)?.code ?? 'zh-TW'
}

/** 手動偏好優先；未設定時依瀏覽器語言順序選擇。SSR 一律維持繁中。 */
export function readInitialLocale(): Locale {
  if (typeof window === 'undefined') return 'zh-TW'
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === 'zh' || supportedLocales.some(({ code }) => code === stored)) {
      return normalizeLocale(stored)
    }
  } catch {
    // 儲存不可用時仍依瀏覽器語言選擇，不影響頁面載入。
  }
  if (typeof navigator !== 'undefined') {
    const languages = navigator.languages?.length ? navigator.languages : [navigator.language]
    for (const language of languages) {
      const base = language.toLowerCase().split('-')[0]
      const supported = supportedLocales.find(({ code }) => code.toLowerCase().split('-')[0] === base)
      if (supported) return supported.code
    }
  }
  return 'zh-TW'
}

export function persistLocale(locale: Locale): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, locale === 'zh-TW' ? 'zh' : locale)
  } catch {
    /* ignore */
  }
}

/** 與 src/ssr/render.ts 的 `<html lang="zh-Hant">` 對齊；只在瀏覽器端執行（不變量 3） */
export function syncDocumentLang(locale: Locale): void {
  if (typeof window === 'undefined') return
  document.documentElement.lang = locale === 'zh-TW' ? 'zh-Hant' : locale
}

export function createI18n(initial: Locale = 'zh-TW') {
  const locale = ref<Locale>(initial)

  function t(key: MessageKey, vars?: Record<string, string | number>): string {
    const table = catalogs[locale.value] ?? catalogs['zh-TW']
    let text = table[key] ?? catalogs['zh-TW'][key] ?? String(key)
    if (vars) {
      text = text.replace(/\{([^{}]+)\}/g, (placeholder, name: string) => (Object.hasOwn(vars, name) ? String(vars[name]) : placeholder))
    }
    return text
  }

  function setLocale(next: Locale) {
    locale.value = next
    persistLocale(next)
    syncDocumentLang(next)
  }

  return { locale, t, setLocale }
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

export function formatDate(iso: string | null | undefined, locale: Locale): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(locale === 'en' ? 'en-US' : locale)
}
