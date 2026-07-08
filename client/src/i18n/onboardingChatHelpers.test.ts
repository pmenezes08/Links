import i18next from 'i18next'
import { beforeAll, describe, expect, it } from 'vitest'

import onboardingChatDe from '../locales/onboarding-chat/de-DE.json'
import onboardingChatEn from '../locales/onboarding-chat/en.json'
import onboardingChatPt from '../locales/onboarding-chat/pt-PT.json'
import { sectionOnlyCompleteMessage, sectionOnlyCompleteOptions } from './onboardingChatHelpers'

import type { TFunction } from 'i18next'

const instance = i18next.createInstance()

beforeAll(async () => {
  await instance.init({
    lng: 'en',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    resources: {
      en: { translation: { onboarding_chat: onboardingChatEn } },
      'pt-PT': { translation: { onboarding_chat: onboardingChatPt } },
      'de-DE': { translation: { onboarding_chat: onboardingChatDe } },
    },
  })
})

describe('sectionOnlyCompleteMessage', () => {
  it('interpolates the section label from the real en catalog', () => {
    const t = instance.getFixedT('en') as TFunction
    const msg = sectionOnlyCompleteMessage(t, 'professional')
    expect(msg).toContain('professional background')
    expect(msg).not.toContain('{{section}}')
    expect(sectionOnlyCompleteMessage(t, 'personal')).toContain('personal background')
  })

  it('resolves localized copy for pt-PT and de-DE (no English leak)', () => {
    const pt = instance.getFixedT('pt-PT') as TFunction
    const ptMsg = sectionOnlyCompleteMessage(pt, 'professional')
    expect(ptMsg).toContain('percurso profissional')
    expect(ptMsg).not.toContain('Your ')

    const de = instance.getFixedT('de-DE') as TFunction
    const deMsg = sectionOnlyCompleteMessage(de, 'personal')
    expect(deMsg).toContain('persönlicher Hintergrund')
    expect(deMsg).not.toContain('Your ')
  })
})

describe('sectionOnlyCompleteOptions', () => {
  it('keeps the behavioral values and localizes labels', () => {
    const pt = instance.getFixedT('pt-PT') as TFunction
    const options = sectionOnlyCompleteOptions(pt)
    expect(options.map(o => o.value)).toEqual(['go_feed', 'edit_profile'])
    expect(options[0].label).toBe('Voltar à comunidade')
  })
})
