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
      { label: "For organisations", href: "/for-community-owners" },
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
  ownerLanding: {
    metaTitle: "Private Community Platform for Organisations | C-Point",
    metaDescription:
      "Run an invitation-only community with a durable feed, chat, member tools, and optional Steve intelligence. Start free for up to 25 members.",
    nav: {
      problem: "Why C-Point",
      features: "Owner tools",
      analytics: "Analytics",
      steve: "Steve",
      pricing: "Pricing",
      faq: "FAQ",
      start: "Start free",
    },
    hero: {
      badge: "Built for community owners",
      title: "Run your community on a private platform — not another group chat.",
      body:
        "Give members one invitation-only home for conversations, shared memory, events, and useful resources. Start free, then grow with community plans and optional Steve intelligence.",
      primary: "Start your community free",
      secondary: "See plans",
      proof: "Free up to 25 members · Paid plans from €49.99/month · 14-day trial",
    },
    problem: {
      kicker: "Keep the context",
      title: "Chat for speed. Feed for memory.",
      intro:
        "Fast conversations matter, but a community needs somewhere for decisions, knowledge, and relationships to keep their value.",
      cards: [
        {
          title: "Stop losing decisions",
          body: "Keep important posts, links, and updates threaded and findable instead of buried in yesterday's chat.",
        },
        {
          title: "Give members one private home",
          body: "Bring the feed, direct messages, group chat, events, polls, files, and useful links into one invitation-only network.",
        },
        {
          title: "Structure growth",
          body: "Use roles and sub-communities for chapters, committees, projects, or cohorts without splitting the organisation across tools.",
        },
      ],
    },
    features: {
      kicker: "Owner toolkit",
      title: "The infrastructure behind an active community.",
      intro:
        "Create a private network, invite the right people, and give members clear places to participate and find what matters.",
      cards: [
        {
          title: "Invitation and member controls",
          body: "Keep membership intentional with invitation-led access, approvals, and clear owner, admin, and member roles.",
        },
        {
          title: "Feed and conversations",
          body: "Use durable community posts for shared memory and chat for fast day-to-day coordination.",
        },
        {
          title: "Events, polls, and resources",
          body: "Plan gatherings, make decisions, and keep files, links, and key posts next to the conversation.",
        },
        {
          title: "Parent and sub-communities",
          body: "Organise chapters, committees, or projects under one community structure, within the limits of your plan.",
        },
      ],
    },
    analytics: {
      kicker: "Owner analytics",
      title: "See what's working — and the one thing to do next.",
      intro:
        "The Owner Dashboard turns community activity into a clear picture of growth and participation, narrated for you — with suggested next moves, never a wall of numbers.",
      metrics: [
        {
          title: "Active members",
          body: "Daily, weekly, and monthly active members, with week-over-week movement, so you know if momentum is building.",
        },
        {
          title: "Invitation funnel",
          body: "Invitations sent and accepted at a glance. Drill into unanswered invites and follow up personally, right from the dashboard.",
        },
        {
          title: "Participation signals",
          body: "See how many members are talking to each other and who is creating momentum — your champions, named and celebrated.",
        },
        {
          title: "Space health",
          body: "Every space labelled thriving, active, quiet, or dormant based on recent participation — so you know which room needs a nudge before it goes cold.",
        },
      ],
      action:
        "Insight comes with the action attached: follow up on unanswered invitations, thank a community champion, and make room before you reach your member cap.",
      paidNote:
        "Paid plans add new-member activation tracking and a whole-network rollup across all your sub-communities.",
      privacy:
        "Privacy-aware by design: member-level data never leaves the server. Owners see aggregates; named lists only ever celebrate visible contributions such as posts, replies, and reactions.",
      cta: "Start understanding your community",
    },
    steve: {
      kicker: "Optional intelligence",
      title: "Add Steve when your paid community is ready.",
      intro:
        "The Steve Community Package gives members a shared intelligent presence in the community feed, groups, and chats. New communities can try the package free for 14 days.",
      bullets: [
        "200 shared Steve credits per month",
        "One allowance shared across community members",
        "Available as a €49.99/month add-on for paid communities",
      ],
      trial: "14-day free Steve trial for new communities",
    },
    pricing: {
      kicker: "Simple community tiers",
      title: "Start small. Upgrade when membership grows.",
      intro:
        "Community plans are based on member capacity. Add the Steve Community Package separately when you want shared AI for the whole space.",
      planNames: {
        free: "Free",
        paid_l1: "Community L1",
        paid_l2: "Community L2",
        paid_l3: "Community L3",
        enterprise: "Enterprise",
      },
      free: "Free",
      perMonth: "/month",
      upTo: "Up to",
      members: "members",
      contact: "Contact sales",
      recommended: "Popular",
      start: "Start free",
      choose: "Choose this plan",
      steveTitle: "Steve Community Package",
      steveBody:
        "€49.99/month for 200 shared credits. Available as an add-on after a community moves to a paid tier.",
      footnote: "Checkout and full plan details are shown in the app after signup.",
      trialFootnote: "Paid-community plans include a 14-day trial, limited to one per customer.",
    },
    faq: {
      kicker: "Questions from owners",
      title: "Know what happens before you invite everyone.",
      items: [
        {
          question: "Can I start without paying?",
          answer:
            "Yes. A free community supports up to 25 members. You can move to a paid tier when you need more capacity.",
        },
        {
          question: "What happens when my community reaches its member limit?",
          answer:
            "The owner is prompted to move to the next community tier before adding members beyond the current plan's cap.",
        },
        {
          question: "Is Steve included in every plan?",
          answer:
            "No. New communities receive a 14-day Steve Community Package trial. After the trial, the package is a €49.99/month add-on available to paid communities.",
        },
        {
          question: "Who can see what members share?",
          answer:
            "Communities are invitation-only. Access is controlled by community membership and roles rather than a public feed.",
        },
        {
          question: "Can larger organisations use C-Point?",
          answer:
            "Yes. Published plans support communities up to 250 members. Contact us for an Enterprise plan if you need more capacity.",
        },
      ],
    },
    finalCta: {
      kicker: "Create your community",
      title: "Give your members a private place worth returning to.",
      body: "Start with up to 25 members for free and add a paid community tier when you are ready to grow.",
      primary: "Start your community free",
      secondary: "Talk to us",
    },
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
    h2Pre: "Intelligence available for",
    h2Highlight: "your community.",
    intro:
      "With an eligible plan, add Steve as a shared intelligent presence that helps bridge gaps, summarise what matters, and connect members when it makes sense.",
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
      { label: "Para organizações", href: "/for-community-owners" },
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
  ownerLanding: {
    metaTitle: "Plataforma de comunidades privadas para organizações | C-Point",
    metaDescription:
      "Gira uma comunidade por convite com feed duradouro, chat, ferramentas para membros e inteligência Steve opcional. Comece grátis até 25 membros.",
    nav: {
      problem: "Porquê a C-Point",
      features: "Ferramentas",
      analytics: "Analítica",
      steve: "Steve",
      pricing: "Preços",
      faq: "Perguntas",
      start: "Começar grátis",
    },
    hero: {
      badge: "Criada para donos de comunidades",
      title: "Gira a sua comunidade numa plataforma privada — não noutro chat de grupo.",
      body:
        "Dê aos membros uma casa por convite para conversas, memória partilhada, eventos e recursos úteis. Comece grátis e cresça com planos de comunidade e inteligência Steve opcional.",
      primary: "Criar a sua comunidade grátis",
      secondary: "Ver planos",
      proof: "Grátis até 25 membros · Planos pagos desde €49,99/mês · 14 dias de teste",
    },
    problem: {
      kicker: "Guarde o contexto",
      title: "Chat para a velocidade. Feed para a memória.",
      intro:
        "As conversas rápidas importam, mas uma comunidade precisa de um lugar onde decisões, conhecimento e relações mantenham o seu valor.",
      cards: [
        {
          title: "Não perca decisões",
          body: "Mantenha publicações, links e atualizações importantes organizados e fáceis de encontrar, em vez de enterrados no chat de ontem.",
        },
        {
          title: "Dê aos membros uma casa privada",
          body: "Junte feed, mensagens diretas, chat de grupo, eventos, sondagens, ficheiros e links úteis numa rede apenas por convite.",
        },
        {
          title: "Estruture o crescimento",
          body: "Use funções e subcomunidades para núcleos, comissões, projetos ou turmas sem dispersar a organização por várias ferramentas.",
        },
      ],
    },
    features: {
      kicker: "Ferramentas para donos",
      title: "A infraestrutura por detrás de uma comunidade ativa.",
      intro:
        "Crie uma rede privada, convide as pessoas certas e dê aos membros lugares claros para participar e encontrar o que importa.",
      cards: [
        {
          title: "Convites e controlo de membros",
          body: "Mantenha a adesão intencional com acesso por convite, aprovações e funções claras de dono, administrador e membro.",
        },
        {
          title: "Feed e conversas",
          body: "Use publicações duradouras como memória partilhada e chat para a coordenação rápida do dia a dia.",
        },
        {
          title: "Eventos, sondagens e recursos",
          body: "Planeie encontros, tome decisões e mantenha ficheiros, links e publicações-chave junto da conversa.",
        },
        {
          title: "Comunidades-mãe e subcomunidades",
          body: "Organize núcleos, comissões ou projetos numa só estrutura, dentro dos limites do seu plano.",
        },
      ],
    },
    analytics: {
      kicker: "Analítica para donos",
      title: "Veja o que está a funcionar — e o próximo passo a dar.",
      intro:
        "O Painel do Dono transforma a atividade da comunidade numa imagem clara do crescimento e da participação, narrada para si — com próximos passos sugeridos, nunca um mural de números.",
      metrics: [
        {
          title: "Membros ativos",
          body: "Membros ativos por dia, semana e mês, com a evolução face à semana anterior, para saber se a dinâmica está a crescer.",
        },
        {
          title: "Funil de convites",
          body: "Convites enviados e aceites num relance. Abra os convites sem resposta e faça o acompanhamento pessoalmente, a partir do painel.",
        },
        {
          title: "Sinais de participação",
          body: "Veja quantos membros comunicam entre si e quem está a criar dinâmica — os seus campeões, com nome e reconhecimento.",
        },
        {
          title: "Saúde dos espaços",
          body: "Cada espaço classificado como próspero, ativo, calmo ou inativo com base na participação recente — para saber que sala precisa de atenção antes de esfriar.",
        },
      ],
      action:
        "A informação chega com a ação incluída: acompanhe convites sem resposta, agradeça a um campeão da comunidade e liberte espaço antes de atingir o limite de membros.",
      paidNote:
        "Os planos pagos acrescentam a ativação de novos membros e uma visão agregada de toda a rede de subcomunidades.",
      privacy:
        "Privacidade desde a origem: os dados individuais nunca saem do servidor. Os donos veem agregados; as listas com nomes celebram apenas contribuições visíveis, como publicações, respostas e reações.",
      cta: "Começar a compreender a sua comunidade",
    },
    steve: {
      kicker: "Inteligência opcional",
      title: "Adicione o Steve quando a sua comunidade paga estiver pronta.",
      intro:
        "O Steve Community Package dá aos membros uma presença inteligente partilhada no feed, nos grupos e nos chats. As novas comunidades podem experimentar o pacote gratuitamente durante 14 dias.",
      bullets: [
        "200 créditos Steve partilhados por mês",
        "Uma quota partilhada por todos os membros da comunidade",
        "Disponível como extra de €49,99/mês para comunidades pagas",
      ],
      trial: "14 dias de teste gratuito do Steve para novas comunidades",
    },
    pricing: {
      kicker: "Escalões simples",
      title: "Comece pequeno. Suba de plano quando crescer.",
      intro:
        "Os planos de comunidade baseiam-se na capacidade de membros. Adicione o Steve Community Package separadamente quando quiser IA partilhada para todo o espaço.",
      planNames: {
        free: "Grátis",
        paid_l1: "Comunidade L1",
        paid_l2: "Comunidade L2",
        paid_l3: "Comunidade L3",
        enterprise: "Enterprise",
      },
      free: "Grátis",
      perMonth: "/mês",
      upTo: "Até",
      members: "membros",
      contact: "Falar com vendas",
      recommended: "Popular",
      start: "Começar grátis",
      choose: "Escolher este plano",
      steveTitle: "Steve Community Package",
      steveBody:
        "€49,99/mês por 200 créditos partilhados. Disponível como extra depois de a comunidade passar para um plano pago.",
      footnote: "O checkout e os detalhes completos do plano aparecem na app depois do registo.",
      trialFootnote: "Os planos pagos de comunidade incluem 14 dias de teste, limitados a um por cliente.",
    },
    faq: {
      kicker: "Perguntas de donos",
      title: "Saiba o que acontece antes de convidar toda a gente.",
      items: [
        {
          question: "Posso começar sem pagar?",
          answer:
            "Sim. Uma comunidade grátis suporta até 25 membros. Pode passar para um plano pago quando precisar de mais capacidade.",
        },
        {
          question: "O que acontece quando a comunidade atinge o limite de membros?",
          answer:
            "O dono recebe um pedido para passar ao escalão seguinte antes de adicionar membros além do limite do plano atual.",
        },
        {
          question: "O Steve está incluído em todos os planos?",
          answer:
            "Não. As novas comunidades recebem 14 dias de teste do Steve Community Package. Depois, o pacote é um extra de €49,99/mês disponível para comunidades pagas.",
        },
        {
          question: "Quem pode ver o que os membros partilham?",
          answer:
            "As comunidades são apenas por convite. O acesso é controlado pela adesão e pelas funções da comunidade, não por um feed público.",
        },
        {
          question: "As organizações maiores podem usar a C-Point?",
          answer:
            "Sim. Os planos publicados suportam comunidades até 250 membros. Fale connosco sobre Enterprise se precisar de mais capacidade.",
        },
      ],
    },
    finalCta: {
      kicker: "Crie a sua comunidade",
      title: "Dê aos membros um lugar privado ao qual vale a pena voltar.",
      body: "Comece gratuitamente com até 25 membros e adicione um plano pago quando estiver pronto para crescer.",
      primary: "Criar a sua comunidade grátis",
      secondary: "Falar connosco",
    },
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
    h2Pre: "Inteligência disponível para",
    h2Highlight: "a sua comunidade.",
    intro:
      "Com um plano elegível, adicione o Steve como presença inteligente partilhada para aproximar pessoas, resumir o que importa e ajudar os membros a ligarem-se quando faz sentido.",
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
