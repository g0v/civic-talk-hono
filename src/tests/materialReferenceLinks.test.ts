import { renderToString } from '@vue/server-renderer'
import { createSSRApp } from 'vue'
import { describe, expect, it } from 'vite-plus/test'
import { provideI18n } from '../l10n'
import ContributeView from '../views/Contribute.vue'

describe('素材參考連結 (#209)', () => {
  it.each(['zh-TW', 'en', 'ja'] as const)('%s 在登入前提供提示內入口與預設關閉的具名彈框', async locale => {
    const app = createSSRApp(ContributeView, { issueId: 1, issueTitle: '測試議題' })
    const { t } = provideI18n(app, locale)
    const html = await renderToString(app)
    const notice = html.match(/<strong>[^<]*<\/strong>([\s\S]*?)<\/div>/)?.[1] ?? ''
    expect(notice).toContain(t('contrib_alert'))
    const trigger = notice.match(/<button\b([^>]*)>([^<]*)<\/button>/)
    expect(trigger?.[1]).toContain('type="button"')
    expect(trigger?.[1]).toContain('aria-haspopup="dialog"')
    expect(trigger?.[1]).toContain('aria-controls="material-reference-links"')
    expect(trigger?.[2]?.trim()).toBe(t('contrib_reference_links'))
    expect(notice.indexOf(t('contrib_alert'))).toBeLessThan(notice.indexOf('<button'))

    const dialog = html.match(/<dialog\b(?=[^>]*\bid="material-reference-links")([^>]*)>([\s\S]*?)<\/dialog>/)
    expect(dialog?.[1]).not.toMatch(/\sopen(?:\s|=|$)/)
    expect(dialog?.[1]).toContain('aria-labelledby="material-reference-links-title"')
    expect(dialog?.[2]).toMatch(new RegExp(`<h2 id="material-reference-links-title"[^>]*>${t('contrib_reference_links')}</h2>`))
    expect(dialog?.[2]).toContain(`aria-label="${t('contrib_reference_close')}"`)

    const links = [...(dialog?.[2] ?? '').matchAll(/<a href="([^"]*)" target="([^"]*)" rel="([^"]*)"[^>]*>([^<]*)<\/a>/g)]
    expect(links.map(([, href, target, rel, label]) => ({ href, target, rel, label }))).toEqual([
      { href: 'https://law.moj.gov.tw/', target: '_blank', rel: 'noopener noreferrer', label: t('contrib_reference_laws').replaceAll('&', '&amp;') },
      { href: 'https://www.ly.gov.tw/Pages/List.aspx?nodeid=102', target: '_blank', rel: 'noopener noreferrer', label: t('contrib_reference_legislature') },
      { href: 'https://all.cc.govapi.tw/info', target: '_blank', rel: 'noopener noreferrer', label: t('contrib_reference_councils') },
      { href: 'https://data.openfun.tw/', target: '_blank', rel: 'noopener noreferrer', label: t('contrib_reference_openfun') },
    ])
  })
})
