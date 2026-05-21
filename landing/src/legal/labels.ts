import type { LegalLocale } from './locale';

export type LegalPageId = 'privacy' | 'terms' | 'safety';

type PageLabels = {
  title: string;
  lastUpdated: string;
  languageLabel: string;
  switchToOther: string;
  alsoAvailableIn: string;
  disclaimer: string;
  footerPrivacy: string;
  footerTerms: string;
  footerSupport: string;
  footerSafety: string;
  footerHome: string;
  footerRights: string;
};

type LocaleLabels = {
  pages: Record<LegalPageId, PageLabels>;
  ageBannerTitle?: string;
  ageBannerBody?: string;
};

const EN: LocaleLabels = {
  pages: {
    privacy: {
      title: 'Privacy Policy',
      lastUpdated: 'Last updated: April 24, 2026',
      languageLabel: 'Language',
      switchToOther: 'Português (Portugal)',
      alsoAvailableIn: 'Also available in',
      disclaimer:
        'This is the authoritative English version. A Portuguese translation is provided for convenience. If there is any conflict, the English version prevails.',
      footerPrivacy: 'Privacy Policy',
      footerTerms: 'Terms of Service',
      footerSupport: 'Support',
      footerSafety: 'Safety',
      footerHome: 'Home',
      footerRights: 'All rights reserved.',
    },
    terms: {
      title: 'Terms of Service',
      lastUpdated: 'Last updated: April 24, 2026',
      languageLabel: 'Language',
      switchToOther: 'Português (Portugal)',
      alsoAvailableIn: 'Also available in',
      disclaimer:
        'This is the authoritative English version. A Portuguese translation is provided for convenience. If there is any conflict, the English version prevails.',
      footerPrivacy: 'Privacy Policy',
      footerTerms: 'Terms of Service',
      footerSupport: 'Support',
      footerSafety: 'Safety',
      footerHome: 'Home',
      footerRights: 'All rights reserved.',
    },
    safety: {
      title: 'Safety Standards',
      lastUpdated: 'Last updated: March 2026',
      languageLabel: 'Language',
      switchToOther: 'Português (Portugal)',
      alsoAvailableIn: 'Also available in',
      disclaimer:
        'This is the authoritative English version. A Portuguese translation is provided for convenience. If there is any conflict, the English version prevails.',
      footerPrivacy: 'Privacy Policy',
      footerTerms: 'Terms of Service',
      footerSupport: 'Support',
      footerSafety: 'Safety',
      footerHome: 'Home',
      footerRights: 'All rights reserved.',
    },
  },
  ageBannerTitle: 'Age Rating: 16+',
  ageBannerBody: 'This app is intended for users aged 16 and older.',
};

const PT: LocaleLabels = {
  pages: {
    privacy: {
      title: 'Política de Privacidade',
      lastUpdated: 'Última atualização: 24 de abril de 2026',
      languageLabel: 'Idioma',
      switchToOther: 'English',
      alsoAvailableIn: 'Também disponível em',
      disclaimer:
        'Versão em português (Portugal) para conveniência. A versão vinculativa em inglês está disponível e prevalece em caso de conflito ou divergência de interpretação.',
      footerPrivacy: 'Política de Privacidade',
      footerTerms: 'Termos de Serviço',
      footerSupport: 'Suporte',
      footerSafety: 'Segurança',
      footerHome: 'Início',
      footerRights: 'Todos os direitos reservados.',
    },
    terms: {
      title: 'Termos de Serviço',
      lastUpdated: 'Última atualização: 24 de abril de 2026',
      languageLabel: 'Idioma',
      switchToOther: 'English',
      alsoAvailableIn: 'Também disponível em',
      disclaimer:
        'Versão em português (Portugal) para conveniência. A versão vinculativa em inglês está disponível e prevalece em caso de conflito ou divergência de interpretação.',
      footerPrivacy: 'Política de Privacidade',
      footerTerms: 'Termos de Serviço',
      footerSupport: 'Suporte',
      footerSafety: 'Segurança',
      footerHome: 'Início',
      footerRights: 'Todos os direitos reservados.',
    },
    safety: {
      title: 'Normas de Segurança',
      lastUpdated: 'Última atualização: março de 2026',
      languageLabel: 'Idioma',
      switchToOther: 'English',
      alsoAvailableIn: 'Também disponível em',
      disclaimer:
        'Versão em português (Portugal) para conveniência. A versão vinculativa em inglês está disponível e prevalece em caso de conflito ou divergência de interpretação.',
      footerPrivacy: 'Política de Privacidade',
      footerTerms: 'Termos de Serviço',
      footerSupport: 'Suporte',
      footerSafety: 'Segurança',
      footerHome: 'Início',
      footerRights: 'Todos os direitos reservados.',
    },
  },
  ageBannerTitle: 'Classificação etária: 16+',
  ageBannerBody: 'Esta aplicação destina-se a utilizadores com 16 anos ou mais.',
};

export function legalLabels(locale: LegalLocale): LocaleLabels {
  return locale === 'pt-PT' ? PT : EN;
}
