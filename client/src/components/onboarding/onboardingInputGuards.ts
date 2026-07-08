// Input guards for the onboarding chat: off-script detection (user asked a
// question instead of answering) and gibberish detection. Pure functions —
// no React, no i18n — so they are unit-testable and shared by the page.
//
// Both guards must work for pt-PT and de-DE users, not just English:
// off-script openers include Portuguese/German question words, and the
// gibberish heuristics only apply to plain-ASCII input (accented words and
// non-Latin scripts skip the vowel/consonant scoring entirely).

// Question-openers across en/pt/de. Deliberately conservative: an opener
// alone only trips the guard on stages that also check for '?' or length.
const OFF_SCRIPT_OPENERS =
  /^(hey|hi|hello|what|how|can|tell|who|ola|olá|oi|o que|como|quem|pode|podes|diz|diga|hallo|was|wie|wer|kannst|können|sag)\b/

const OFF_SCRIPT_SHORT_OPENERS =
  /^(hey|what|how|can|tell|who|ola|olá|oi|o que|como|quem|pode|podes|diz|diga|hallo|was|wie|wer|kannst|können|sag)\b/

export function detectOffScript(currentStage: string, input: string): boolean {
  if (
    currentStage === 'b2b_network_size' ||
    currentStage === 'b2b_tier_guidance' ||
    currentStage === 'b2b_org_type' ||
    currentStage === 'b2b_parent_name' ||
    currentStage === 'b2b_sub_names' ||
    currentStage === 'manual_bio_edit'
  ) {
    return false
  }
  const lower = input.toLowerCase()
  if (currentStage === 'name') {
    return lower.length > 60 || lower.includes('?') || OFF_SCRIPT_OPENERS.test(lower)
  }
  if (currentStage === 'professional') {
    return lower.length > 150 || (lower.includes('?') && !lower.includes('at'))
  }
  if (currentStage === 'location') {
    return lower.length > 80 || (OFF_SCRIPT_SHORT_OPENERS.test(lower) && lower.includes('?'))
  }
  if (currentStage === 'linkedin') {
    if (lower.includes('linkedin.com') || lower.includes('skip')) return false
    return lower.includes('?') || OFF_SCRIPT_SHORT_OPENERS.test(lower)
  }
  if (currentStage === 'optional_social') {
    if (/instagram\.|tiktok\.|snapchat\.|facebook\.|fb\.com/i.test(lower) || lower.includes('skip')) return false
    return lower.includes('?') || OFF_SCRIPT_SHORT_OPENERS.test(lower)
  }
  return false
}

export function looksLikeMeaninglessInput(val: string): boolean {
  const trimmed = val.trim()
  if (trimmed.length < 3) return true
  if (/^(.)\1{2,}$/i.test(trimmed)) return true
  // Symbol-only check, Unicode-aware: CJK/Cyrillic/Arabic letters and any
  // digits count as content.
  if (/^[^\p{L}\p{N}\s]*$/u.test(trimmed)) return true
  // The vowel/consonant heuristics below assume English orthography — skip
  // them for input containing any non-ASCII letter ("Geschäftsführer",
  // "São João", 日本語) rather than misclassifying it as gibberish.
  if (/[^\x00-\x7F]/.test(trimmed)) return false
  const words = trimmed.split(/\s+/)
  const hasVowelWord = words.some(w => /[aeiouAEIOU]/.test(w) && w.length > 1)
  if (!hasVowelWord && trimmed.length < 8) return true
  const consonantRun = trimmed.replace(/[^a-zA-Z]/g, '')
  if (consonantRun.length >= 4 && !/[aeiouAEIOU]/.test(consonantRun)) return true
  return false
}
