import { describe, expect, it } from 'vitest'

import i18n, { DEFAULT_LOCALE, matchLocale, normalizeLocale } from './index'

describe('matchLocale', () => {
  it('returns null when the tag is unknown', () => {
    expect(matchLocale('klingon')).toBeNull()
    expect(matchLocale('xx-YY')).toBeNull()
    expect(matchLocale(null)).toBeNull()
    expect(matchLocale('')).toBeNull()
  })

  it('accepts every English variant', () => {
    expect(matchLocale('en')).toBe('en')
    expect(matchLocale('EN')).toBe('en')
    expect(matchLocale('en-US')).toBe('en')
    expect(matchLocale('en-GB')).toBe('en')
    expect(matchLocale('en_AU')).toBe('en')
  })

  it('routes Portuguese variants to pt-PT (v1 ships PT only)', () => {
    expect(matchLocale('pt')).toBe('pt-PT')
    expect(matchLocale('pt-PT')).toBe('pt-PT')
    expect(matchLocale('pt_PT')).toBe('pt-PT')
    expect(matchLocale('PT-pt')).toBe('pt-PT')
    expect(matchLocale('pt-BR')).toBe('pt-PT')
  })

  it('routes German variants to de-DE (de-AT / de-CH included)', () => {
    expect(matchLocale('de')).toBe('de-DE')
    expect(matchLocale('de-DE')).toBe('de-DE')
    expect(matchLocale('de_DE')).toBe('de-DE')
    expect(matchLocale('DE-de')).toBe('de-DE')
    expect(matchLocale('de-AT')).toBe('de-DE')
    expect(matchLocale('de-CH')).toBe('de-DE')
  })
})

describe('normalizeLocale', () => {
  it('falls back to the default when input is unrecognised', () => {
    expect(normalizeLocale('klingon')).toBe(DEFAULT_LOCALE)
    expect(normalizeLocale(undefined)).toBe(DEFAULT_LOCALE)
  })

  it('keeps a supported locale unchanged', () => {
    expect(normalizeLocale('pt-PT')).toBe('pt-PT')
    expect(normalizeLocale('de-DE')).toBe('de-DE')
    expect(normalizeLocale('en-US')).toBe('en')
  })
})

describe('runtime translation resources', () => {
  it.each(['pt-PT', 'pt', 'pt-pt'])('renders Portuguese strings for %s', async (tag) => {
    await i18n.changeLanguage(tag)
    expect(i18n.t('account.language.section_title')).toBe('Idioma')
    expect(i18n.t('account.language.helper')).toContain('aplicação')
  })

  it.each(['de-DE', 'de', 'de-de'])('renders German strings for %s', async (tag) => {
    await i18n.changeLanguage(tag)
    expect(i18n.t('account.language.section_title')).toBe('Sprache')
    expect(i18n.t('account.language.helper')).toContain('App')
  })

  it('renders English strings after switching back', async () => {
    await i18n.changeLanguage('en')
    expect(i18n.t('account.language.section_title')).toBe('Language')
  })
})
