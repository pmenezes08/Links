/**
 * EN/PT copy for the marketing site. EN is the source of truth; headline
 * strings shared with the client app come from content/siteCopy.ts so they
 * stay in sync with client/src/content/aboutCPoint.ts.
 *
 * pt-PT register: European Portuguese, formal-neutral ("o seu", never "tu").
 * Product terms: Steve stays "Steve"; "feed" and "chat" stay untranslated
 * (they are the product's own vocabulary in the app's pt-PT catalogs too).
 */

import {
  HERO_SUBHEAD,
  MANIFESTO_FULL,
  MANIFESTO_SUMMARY_PARAS,
  PLATFORM_AVAILABILITY_LINE,
  androidStoreLabel,
} from "@/content/siteCopy";

export type Lang = "en" | "pt";

const en = {
  nav: {
    links: [
      { label: "Why C-Point", href: "#why-cpoint" },
      { label: "Who it's for", href: "#audiences" },
      { label: "Steve", href: "#steve" },
      { label: "Communities", href: "#communities" },
      { label: "Tools", href: "#tools" },
      { label: "Plans", href: "#membership" },
    ],
    webShort: "Web",
    webApp: "Web app",
    downloadIos: "Download for iOS",
    getAndroid: "Get for Android",
    openWebApp: "Open web app",
    menuAria: "Menu",
    languageAria: "Language",
  },
  hero: {
    badge: "A global platform of private networks",
    h1Pre: "Enter the network where ideas",
    h1Italic: "connect",
    h1Post: "people",
    subhead: HERO_SUBHEAD,
    availability: PLATFORM_AVAILABILITY_LINE,
    downloadIos: "Download for iOS",
    openWebApp: "Open web app",
    footnote:
      "Invitation-only communities — from alumni and associations to the circles that matter in your life.",
    bgAlt: "People connecting",
  },
  manifesto: {
    kicker: "C-Point manifesto",
    h2Pre: "The world is meant to be",
    h2Highlight: "lived.",
    paras: MANIFESTO_SUMMARY_PARAS,
    readFull: "Read the full manifesto",
    dialogTitle: "Full manifesto",
    full: MANIFESTO_FULL,
  },
  privateNetworks: {
    kicker: "Global platform of private micro-networks",
    h2Pre: "Chat for speed. Feed for",
    h2Highlight: "memory.",
    intro:
      "C-Point still has direct messages and group chats for fast coordination — and a real community feed so posts, links, and decisions stay threaded and findable inside each invite-only network.",
    cards: [
      {
        title: "Chat moves fast — context disappears",
        body: "Plans, links, and decisions get buried in noisy group threads. What mattered last week is hard to find today.",
      },
      {
        title: "Noise without a memory",
        body: "Scroll-heavy feeds elsewhere mix you with the wider world. Important work inside your circle deserves its own durable layer.",
      },
      {
        title: "Groups on someone else's map",
        body: "A private network is not the same as a group bolted onto a large public professional graph. C-Point is a global platform of invite-only networks — each with its own people, feed, and memory.",
      },
    ],
  },
  audiences: {
    kicker: "Who it's for",
    h2Pre: "One platform,",
    h2Highlight: "two journeys.",
    intro:
      "The same global platform hosts private networks for personal circles and for organisations that need a serious home for their people.",
    cards: [
      {
        label: "For your circle",
        subtitle: "Friends, family, hobbies — personal networks",
        bullets: [
          "Reconnect with your people without public feeds, algorithms, or strangers.",
          "Each community is invitation-only; the feed is shared memory for the group.",
          "Chat for day-to-day coordination; Steve when you want help with context.",
        ],
      },
      {
        label: "For organisers & organisations",
        subtitle: "Alumni, members, staff, customers",
        bullets: [
          "Run private, invitation-only spaces for people who actually belong in the room.",
          "Structured feeds, polls, calendar-friendly workflows, and optional sub-groups under one umbrella — within your plan.",
          "Steve as the shared intelligent presence that keeps the community warm and connected.",
        ],
      },
    ],
  },
  appShowcase: {
    kicker: "Memory Across Micro-Networks",
    h2Pre: "Memory for each",
    h2Highlight: "network.",
    intro:
      "See your communities, a cross-network home feed, rich profiles, and messaging — a private layer for every group you belong to, without a public timeline for strangers.",
    captions: { communities: "Communities", profile: "Profile", messaging: "Messaging" },
    alts: {
      communities: "C-Point Dashboard - Your Communities",
      profile: "C-Point Professional Profile",
      messaging: "C-Point Direct Messages",
    },
  },
  steve: {
    kicker: "Meet Steve",
    h2Pre: "Intelligent presence in",
    h2Highlight: "every community.",
    intro:
      "Steve isn't bolted-on support — he lives inside each private network to bridge gaps, summarise what matters, and help members connect when it makes sense.",
    cards: [
      {
        title: "Steve in DMs & group chats",
        tagline: "Where you already talk.",
        description:
          "Message Steve one-to-one for product help or a second opinion, and bring him into group chats when the room wants context — including tagging @Steve when your plan allows.",
      },
      {
        title: "Steve in the feed",
        tagline: "Threads that stay readable.",
        description:
          "Use Steve on community posts and long threads so ideas stay summarised and searchable — not lost under yesterday's scroll.",
      },
      {
        title: "Voice summaries",
        tagline: "Catch up without hitting play on everything.",
        description:
          "Voice notes can be transcribed and summarised so busy members stay in the loop when listening isn't an option.",
      },
      {
        title: "Networking matches",
        tagline: "Introductions across your networks.",
        description:
          "Steve can help surface people you should meet based on roles, skills, and interests — inside the private networks you already trust.",
      },
      {
        title: "Cross-language tone",
        tagline: "Many languages, one community spirit.",
        description:
          "Steve adapts across languages such as English, Portuguese, and Spanish so tone and nuance fit your group's culture.",
      },
    ],
    quote: '"Your community has a brain. His name is Steve."',
  },
  identity: {
    kicker: "Trust inside private micro-networks",
    h2Pre: "Trust inside",
    h2Highlight: "private networks.",
    intro:
      "Profiles are built for real collaboration in closed circles — not for performing to the whole internet. Show your expertise so the people who were invited alongside you know who to turn to.",
    points: [
      "Dedicated fields for role, company, and industry",
      "Professional interests that help the right people find you",
      "Rich bios visible to members in the networks you share",
      "Privacy-first — invitation-only spaces, you control what's shared",
    ],
    profile: {
      role: "CTO · TechVentures · Lisbon",
      industryLabel: "Industry",
      industry: "Technology & AI",
      interestsLabel: "Interests",
      bioLabel: "Bio",
      bio: "Building the next generation of community tools. Previously scaled teams from 5 to 100+.",
    },
  },
  communities: {
    kicker: "Community Infrastructure",
    h2Pre: "Own Your",
    h2Highlight: "Network.",
    intro:
      "One global platform hosts many private networks. Structure yours with parent and sub-communities, each with its own discussion feed, calendars, and resources — so focus and history stay where they belong.",
    cards: [
      {
        title: "Private by Default",
        description:
          "Invite-only communities with approval controls. Each private network stands on its own — not a tab inside a global feed for strangers.",
      },
      {
        title: "Nested Sub-Communities",
        description:
          "Create focused sub-groups under a parent community for committees, chapters, or projects — within your plan.",
      },
      {
        title: "Group Workspaces",
        description:
          "Each group gets its own feed, calendar, photos, and member management — its own durable memory and rituals.",
      },
      {
        title: "Role-Based Access",
        description:
          "Owners, admins, and members — clear hierarchy with granular permissions at every level.",
      },
    ],
  },
  tools: {
    kicker: "Tools for every micro-network",
    h2Pre: "Everything in",
    h2Highlight: "One Place.",
    intro:
      "Fewer detached tools: events, polls, files, tasks, links, and highlights — alongside chat and your community feed.",
    cards: [
      {
        title: "Event Calendar & RSVPs",
        description: "Schedule events, invite members, and track RSVPs — all within your community.",
      },
      {
        title: "Community Polls",
        description: "Make decisions together. Create polls, vote, and see results in context.",
      },
      {
        title: "Shared Documents & Resources",
        description: "Centralise files and resources your community needs — next to the conversation.",
      },
      {
        title: "Tasks",
        description: "Track what needs doing inside a community so commitments don't vanish into chat.",
      },
      {
        title: "Useful Links",
        description: "Curate links the group relies on — one place instead of re-pasting in threads.",
      },
      {
        title: "Key Posts",
        description: "Surface important announcements or reference posts so new members land on what matters.",
      },
      {
        title: "Notifications",
        description: `Stay in the loop with real-time alerts where supported. ${PLATFORM_AVAILABILITY_LINE}`,
      },
    ],
  },
  membership: {
    kicker: "Membership",
    h2Pre: "Plans for",
    h2Highlight: "your communities.",
    intro:
      "We don't put stale prices on a static page — open the app for up-to-date plans, caps, and billing.",
    cards: [
      {
        title: "Community paid tiers",
        body: "Upgrade a community to a paid tier for higher member caps, more media storage, and optional add-ons — sized from a close circle to a full organisation. Current plans and caps are always shown in the app.",
      },
      {
        title: "Steve Community Package",
        body: "Add Steve to a paid community so every member shares the same intelligent presence in the feed, groups, and chats — one shared allowance for the whole space, configured in community settings in-app.",
      },
    ],
    cta: "View plans in the app",
  },
  cta: {
    kicker: "Get Started",
    h2Pre: "Ready to join a",
    h2Highlight: "private network?",
    availability: PLATFORM_AVAILABILITY_LINE,
    downloadIos: "Download for iOS",
    openWebApp: "Open web app",
    contact: "Have questions? Contact us",
    push: "Push notifications where supported across iOS, Android, and Web.",
  },
  footer: {
    tagline:
      "A global platform of private networks — invitation-only, with Steve in every community.",
    manifesto: "Manifesto",
    privacy: "Privacy",
    terms: "Terms",
    support: "Support",
    safety: "Safety",
    crossLang: [
      { label: "Privacidade (PT)", to: "/pt/privacy", lang: "pt-PT" },
      { label: "Termos (PT)", to: "/pt/terms", lang: "pt-PT" },
    ],
    operator: "Operator login",
    rights: "All rights reserved.",
    legalPaths: { privacy: "/privacy", terms: "/terms", safety: "/safety" },
  },
  contact: {
    title: "Get in Touch",
    description:
      "Have questions? We'd love to hear from you. Send us a message and we'll respond as soon as possible.",
    nameLabel: "Name",
    namePlaceholder: "Your name",
    emailLabel: "Email",
    emailPlaceholder: "your.email@example.com",
    messageLabel: "Message",
    messagePlaceholder: "Tell us how we can help...",
    submit: "Send Message",
    sending: "Sending...",
    errorTitle: "Error",
    fillAll: "Please fill in all fields",
    invalidEmail: "Please enter a valid email address",
    sentTitle: "Message Sent!",
    sentDescription: "We'll get back to you as soon as possible.",
    genericError: "Something went wrong. Please try again.",
    floatingAria: "Contact us",
  },
  android: {
    get: "Get for Android",
    storeLabel: androidStoreLabel,
  },
};

export type SiteCopy = typeof en;

const pt: SiteCopy = {
  nav: {
    links: [
      { label: "Porquê a C-Point", href: "#why-cpoint" },
      { label: "Para quem é", href: "#audiences" },
      { label: "Steve", href: "#steve" },
      { label: "Comunidades", href: "#communities" },
      { label: "Ferramentas", href: "#tools" },
      { label: "Planos", href: "#membership" },
    ],
    webShort: "Web",
    webApp: "App web",
    downloadIos: "Descarregar para iOS",
    getAndroid: "Obter para Android",
    openWebApp: "Abrir a app web",
    menuAria: "Menu",
    languageAria: "Idioma",
  },
  hero: {
    badge: "Uma plataforma global de redes privadas",
    h1Pre: "Entre na rede onde as ideias",
    h1Italic: "ligam",
    h1Post: "pessoas",
    subhead:
      "A C-Point é uma plataforma global de micro-redes privadas, apenas por convite. Cada rede é um mundo próprio — sem feeds públicos, sem estranhos, sem ruído de algoritmos. Volte a ligar-se às suas pessoas, guarde a memória partilhada num feed a sério e conte com o Steve como presença inteligente em cada comunidade.",
    availability: "iOS, Android e Web já disponíveis.",
    downloadIos: "Descarregar para iOS",
    openWebApp: "Abrir a app web",
    footnote:
      "Comunidades apenas por convite — dos antigos alunos e associações aos círculos que importam na sua vida.",
    bgAlt: "Pessoas a ligarem-se",
  },
  manifesto: {
    kicker: "Manifesto C-Point",
    h2Pre: "O mundo é para ser",
    h2Highlight: "vivido.",
    paras: [
      "A C-Point nasceu de um princípio simples: o mundo é para ser vivido — volte a ligar-se às suas pessoas em comunidades apenas por convite, sem feeds públicos nem ruído de algoritmos.",
      "O Steve vive dentro de cada comunidade como presença inteligente; tudo o que é partilhado fica lá dentro até que decida o contrário.",
    ],
    readFull: "Ler o manifesto completo",
    dialogTitle: "Manifesto completo",
    full: `Manifesto C-Point

A C-Point nasceu de um princípio simples: o mundo é para ser vivido. Venha reencontrar as suas pessoas, estar presente no seu mundo e voltar, de facto, a viver.

A C-Point é uma plataforma global de comunidades privadas e independentes.
Sem feeds públicos. Sem autopromoção. Sem ruído de algoritmos. Sem conteúdo de consumo rápido.

Uma comunidade pode ser o que quiser — um grupo próximo de amigos a planear viagens, um círculo a debater o futuro, um espaço de conversa com quem realmente o entende, ou a rede privada que o liga às organizações que importam: o seu grupo de antigos alunos, a sua escola, uma rede de investidores, o seu clube desportivo ou a sua empresa.

Dentro de cada comunidade vive o Steve — a nossa presença inteligente, que compreende profundamente o percurso, os valores e a experiência de cada membro, e trabalha discretamente para criar ligações com significado e manter o espaço vivo.

O acesso é apenas por convite. A privacidade e a exclusividade fazem parte desde o primeiro dia. Tudo o que é partilhado lá dentro fica lá dentro. Sem estranhos. Sem algoritmos a decidir o que merece a sua atenção.

Este é o seu mundo. Venha ligar-se a ele.`,
  },
  privateNetworks: {
    kicker: "Plataforma global de micro-redes privadas",
    h2Pre: "Chat para a velocidade. Feed para a",
    h2Highlight: "memória.",
    intro:
      "A C-Point tem mensagens diretas e chats de grupo para coordenar depressa — e um verdadeiro feed de comunidade para que publicações, links e decisões fiquem organizados e fáceis de encontrar dentro de cada rede por convite.",
    cards: [
      {
        title: "O chat corre depressa — o contexto desaparece",
        body: "Planos, links e decisões ficam enterrados em conversas de grupo ruidosas. O que importava na semana passada é difícil de encontrar hoje.",
      },
      {
        title: "Ruído sem memória",
        body: "Os feeds infinitos lá fora misturam-no com o mundo inteiro. O que é importante dentro do seu círculo merece uma camada própria e duradoura.",
      },
      {
        title: "Grupos no mapa de outra pessoa",
        body: "Uma rede privada não é o mesmo que um grupo pendurado num grande grafo profissional público. A C-Point é uma plataforma global de redes por convite — cada uma com as suas pessoas, o seu feed e a sua memória.",
      },
    ],
  },
  audiences: {
    kicker: "Para quem é",
    h2Pre: "Uma plataforma,",
    h2Highlight: "dois caminhos.",
    intro:
      "A mesma plataforma global acolhe redes privadas para círculos pessoais e para organizações que precisam de uma casa a sério para as suas pessoas.",
    cards: [
      {
        label: "Para o seu círculo",
        subtitle: "Amigos, família, interesses — redes pessoais",
        bullets: [
          "Volte a ligar-se às suas pessoas sem feeds públicos, algoritmos ou estranhos.",
          "Cada comunidade é apenas por convite; o feed é a memória partilhada do grupo.",
          "Chat para a coordenação do dia a dia; Steve quando quiser ajuda com contexto.",
        ],
      },
      {
        label: "Para organizadores e organizações",
        subtitle: "Antigos alunos, sócios, equipas, clientes",
        bullets: [
          "Crie espaços privados, apenas por convite, para quem realmente pertence à sala.",
          "Feeds estruturados, sondagens, calendário e subgrupos opcionais debaixo do mesmo teto — conforme o seu plano.",
          "O Steve como presença inteligente partilhada que mantém a comunidade viva e ligada.",
        ],
      },
    ],
  },
  appShowcase: {
    kicker: "Memória em todas as micro-redes",
    h2Pre: "Memória para cada",
    h2Highlight: "rede.",
    intro:
      "Veja as suas comunidades, um feed agregado de todas as redes, perfis ricos e mensagens — uma camada privada para cada grupo a que pertence, sem cronologia pública para estranhos.",
    captions: { communities: "Comunidades", profile: "Perfil", messaging: "Mensagens" },
    alts: {
      communities: "Painel C-Point — as suas comunidades",
      profile: "Perfil profissional C-Point",
      messaging: "Mensagens diretas C-Point",
    },
  },
  steve: {
    kicker: "Conheça o Steve",
    h2Pre: "Presença inteligente em",
    h2Highlight: "cada comunidade.",
    intro:
      "O Steve não é um suporte acrescentado — vive dentro de cada rede privada para aproximar pessoas, resumir o que importa e ajudar os membros a ligarem-se quando faz sentido.",
    cards: [
      {
        title: "Steve nas mensagens e chats de grupo",
        tagline: "Onde já conversa.",
        description:
          "Fale com o Steve a sós para pedir ajuda ou uma segunda opinião, e traga-o para os chats de grupo quando a sala precisa de contexto — incluindo mencionar @Steve quando o seu plano o permite.",
      },
      {
        title: "Steve no feed",
        tagline: "Conversas que continuam legíveis.",
        description:
          "Use o Steve nas publicações e nas conversas longas para que as ideias fiquem resumidas e pesquisáveis — em vez de perdidas no scroll de ontem.",
      },
      {
        title: "Resumos de voz",
        tagline: "Fique a par sem ouvir tudo.",
        description:
          "As notas de voz podem ser transcritas e resumidas para que os membros ocupados acompanhem tudo mesmo quando não podem ouvir.",
      },
      {
        title: "Ligações na rede",
        tagline: "Apresentações dentro das suas redes.",
        description:
          "O Steve ajuda a encontrar pessoas que devia conhecer, com base em funções, competências e interesses — dentro das redes privadas em que já confia.",
      },
      {
        title: "Tom em várias línguas",
        tagline: "Muitas línguas, um só espírito de comunidade.",
        description:
          "O Steve adapta-se a línguas como o português, o inglês e o espanhol, para que o tom e a nuance respeitem a cultura do seu grupo.",
      },
    ],
    quote: "“A sua comunidade tem um cérebro. Chama-se Steve.”",
  },
  identity: {
    kicker: "Confiança dentro de micro-redes privadas",
    h2Pre: "Confiança dentro de",
    h2Highlight: "redes privadas.",
    intro:
      "Os perfis são feitos para colaboração real em círculos fechados — não para atuar para a internet inteira. Mostre a sua experiência para que quem foi convidado consigo saiba a quem recorrer.",
    points: [
      "Campos dedicados para função, empresa e setor",
      "Interesses profissionais que ajudam as pessoas certas a encontrá-lo",
      "Biografias ricas, visíveis para os membros das redes que partilha",
      "Privacidade primeiro — espaços apenas por convite; controla o que é partilhado",
    ],
    profile: {
      role: "CTO · TechVentures · Lisboa",
      industryLabel: "Setor",
      industry: "Tecnologia e IA",
      interestsLabel: "Interesses",
      bioLabel: "Bio",
      bio: "A construir a próxima geração de ferramentas para comunidades. Antes, fez crescer equipas de 5 para mais de 100.",
    },
  },
  communities: {
    kicker: "Infraestrutura de comunidades",
    h2Pre: "A rede é",
    h2Highlight: "sua.",
    intro:
      "Uma plataforma global acolhe muitas redes privadas. Estruture a sua com comunidades-mãe e subcomunidades, cada uma com o seu feed de discussão, calendários e recursos — para que o foco e a história fiquem onde pertencem.",
    cards: [
      {
        title: "Privado por definição",
        description:
          "Comunidades por convite com controlo de aprovação. Cada rede privada existe por si — não é um separador dentro de um feed global para estranhos.",
      },
      {
        title: "Subcomunidades aninhadas",
        description:
          "Crie subgrupos focados dentro de uma comunidade-mãe para comissões, núcleos ou projetos — conforme o seu plano.",
      },
      {
        title: "Espaços de grupo",
        description:
          "Cada grupo tem o seu feed, calendário, fotografias e gestão de membros — a sua própria memória e os seus rituais.",
      },
      {
        title: "Acessos por função",
        description:
          "Donos, administradores e membros — hierarquia clara com permissões detalhadas a cada nível.",
      },
    ],
  },
  tools: {
    kicker: "Ferramentas para cada micro-rede",
    h2Pre: "Tudo num",
    h2Highlight: "só lugar.",
    intro:
      "Menos ferramentas soltas: eventos, sondagens, ficheiros, tarefas, links e destaques — ao lado do chat e do feed da sua comunidade.",
    cards: [
      {
        title: "Calendário de eventos e presenças",
        description:
          "Agende eventos, convide membros e acompanhe confirmações de presença — tudo dentro da comunidade.",
      },
      {
        title: "Sondagens",
        description: "Decidam em conjunto. Crie sondagens, vote e veja os resultados em contexto.",
      },
      {
        title: "Documentos e recursos partilhados",
        description:
          "Centralize os ficheiros e recursos de que a comunidade precisa — ao lado da conversa.",
      },
      {
        title: "Tarefas",
        description:
          "Acompanhe o que há para fazer dentro da comunidade, para que os compromissos não se percam no chat.",
      },
      {
        title: "Links úteis",
        description:
          "Reúna os links de que o grupo depende — um só lugar, em vez de colar e recolar nas conversas.",
      },
      {
        title: "Publicações-chave",
        description:
          "Destaque anúncios importantes ou publicações de referência para que os novos membros encontrem logo o que importa.",
      },
      {
        title: "Notificações",
        description:
          "Fique a par com alertas em tempo real onde suportado. iOS, Android e Web já disponíveis.",
      },
    ],
  },
  membership: {
    kicker: "Adesão",
    h2Pre: "Planos para",
    h2Highlight: "as suas comunidades.",
    intro:
      "Não pomos preços desatualizados numa página estática — abra a app para ver planos, limites e faturação sempre atuais.",
    cards: [
      {
        title: "Escalões pagos de comunidade",
        body: "Suba uma comunidade para um escalão pago e tenha mais membros, mais armazenamento de media e extras opcionais — do círculo próximo a uma organização inteira. Os planos e limites atuais estão sempre na app.",
      },
      {
        // Product name is a proper noun — never translated in any locale.
        title: "Steve Community Package",
        body: "Adicione o Steve a uma comunidade paga para que todos os membros partilhem a mesma presença inteligente no feed, nos grupos e nas conversas — uma quota partilhada para todo o espaço, configurada nas definições da comunidade, na app.",
      },
    ],
    cta: "Ver planos na app",
  },
  cta: {
    kicker: "Comece já",
    h2Pre: "Pronto para entrar numa",
    h2Highlight: "rede privada?",
    availability: "iOS, Android e Web já disponíveis.",
    downloadIos: "Descarregar para iOS",
    openWebApp: "Abrir a app web",
    contact: "Tem dúvidas? Fale connosco",
    push: "Notificações push onde suportado, em iOS, Android e Web.",
  },
  footer: {
    tagline:
      "Uma plataforma global de redes privadas — apenas por convite, com o Steve em cada comunidade.",
    manifesto: "Manifesto",
    privacy: "Privacidade",
    terms: "Termos",
    support: "Suporte",
    safety: "Segurança",
    crossLang: [
      { label: "Privacy (EN)", to: "/privacy", lang: "en" },
      { label: "Terms (EN)", to: "/terms", lang: "en" },
    ],
    operator: "Operator login",
    rights: "Todos os direitos reservados.",
    legalPaths: { privacy: "/pt/privacy", terms: "/pt/terms", safety: "/pt/safety" },
  },
  contact: {
    title: "Fale connosco",
    description:
      "Tem dúvidas? Gostamos de ouvir. Envie-nos uma mensagem e responderemos o mais depressa possível.",
    nameLabel: "Nome",
    namePlaceholder: "O seu nome",
    emailLabel: "Email",
    emailPlaceholder: "o.seu.email@exemplo.com",
    messageLabel: "Mensagem",
    messagePlaceholder: "Diga-nos como podemos ajudar...",
    submit: "Enviar mensagem",
    sending: "A enviar...",
    errorTitle: "Erro",
    fillAll: "Preencha todos os campos",
    invalidEmail: "Introduza um endereço de email válido",
    sentTitle: "Mensagem enviada!",
    sentDescription: "Entraremos em contacto o mais depressa possível.",
    genericError: "Algo correu mal. Tente novamente.",
    floatingAria: "Contacte-nos",
  },
  android: {
    get: "Obter para Android",
    storeLabel: "Obtenha a C-Point no Google Play",
  },
};

export const COPY: Record<Lang, SiteCopy> = { en, pt };
