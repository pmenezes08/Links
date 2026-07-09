import { describe, expect, it } from 'vitest'

import { detectOffScript, looksLikeMeaninglessInput } from './onboardingInputGuards'

describe('detectOffScript', () => {
  it('detects English questions at the name stage', () => {
    expect(detectOffScript('name', 'what is this app?')).toBe(true)
    expect(detectOffScript('name', 'hey, who are you')).toBe(true)
  })

  it('detects Portuguese and German questions at the name stage', () => {
    expect(detectOffScript('name', 'Olá, quem és tu?')).toBe(true)
    expect(detectOffScript('name', 'o que é isto')).toBe(true)
    expect(detectOffScript('name', 'wer bist du?')).toBe(true)
    expect(detectOffScript('name', 'kannst du mir helfen')).toBe(true)
  })

  it('accepts plain names in any language', () => {
    expect(detectOffScript('name', 'Ana Silva')).toBe(false)
    expect(detectOffScript('name', 'Jürgen Müller')).toBe(false)
    expect(detectOffScript('name', 'João Pereira')).toBe(false)
  })

  it('does not treat answers starting with an opener-substring as questions', () => {
    // "Olavo" starts with "ola" but the \b boundary must not match it.
    expect(detectOffScript('name', 'Olavo Costa')).toBe(false)
    expect(detectOffScript('name', 'Sage Williams')).toBe(false)
  })

  it('keeps linkedin/social skip paths intact', () => {
    expect(detectOffScript('linkedin', 'https://linkedin.com/in/ana')).toBe(false)
    expect(detectOffScript('linkedin', 'wie funktioniert das?')).toBe(true)
    expect(detectOffScript('optional_social', 'skip')).toBe(false)
  })

  it('never fires on B2B and manual-edit stages', () => {
    expect(detectOffScript('b2b_parent_name', 'what should I call it?')).toBe(false)
    expect(detectOffScript('manual_bio_edit', 'how do I write this?')).toBe(false)
  })
})

describe('looksLikeMeaninglessInput', () => {
  it('still catches ASCII gibberish', () => {
    expect(looksLikeMeaninglessInput('sdfghjk')).toBe(true)
    expect(looksLikeMeaninglessInput('xxxx')).toBe(true)
    expect(looksLikeMeaninglessInput('???')).toBe(true)
    expect(looksLikeMeaninglessInput('a')).toBe(true)
  })

  it('accepts real English input', () => {
    expect(looksLikeMeaninglessInput('I love hiking and photography')).toBe(false)
  })

  it('accepts accented Portuguese and German input', () => {
    expect(looksLikeMeaninglessInput('Sou engenheiro de software')).toBe(false)
    expect(looksLikeMeaninglessInput('São João da Madeira')).toBe(false)
    expect(looksLikeMeaninglessInput('Geschäftsführer')).toBe(false)
    expect(looksLikeMeaninglessInput('Müller & Söhne GmbH')).toBe(false)
  })

  it('accepts non-Latin scripts instead of scoring them as gibberish', () => {
    expect(looksLikeMeaninglessInput('日本語を話します')).toBe(false)
    expect(looksLikeMeaninglessInput('Инженер-программист')).toBe(false)
  })
})
