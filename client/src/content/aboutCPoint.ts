/** Stable slot ids — must match backend about_tutorials.ALLOWED_SLOTS */

export const ABOUT_CPOINT_VERSION_LABEL = '2.4.1'

export const MANIFESTO_SUMMARY_PARAS: string[] = [
  'C-Point is built on a simple belief: meaningful private communities change how people connect. We give organisers tools to run invitation-only spaces, and members a place to participate without public feeds or algorithmic noise.',
  'Your dashboard reflects only the networks you belong to. Empty at first is intentional — it protects privacy until you create or join a community.',
]

export const MANIFESTO_FULL = `C-Point Manifesto

We believe people deserve spaces online that feel as intentional as the relationships they build offline.

C-Point is a platform of private, independent networks — communities — that you choose to enter by invitation or creation. There is no global public timeline designed to maximize engagement at the cost of attention and trust.

We design for:
• Privacy — your activity stays inside the communities you join unless you choose otherwise.
• Clarity — fewer surfaces, less noise, more context from people who matter to you.
• Agency — organisers shape their spaces; members know where they are and why.

Steve is part of the platform to help you navigate the product, save time on long threads and voice notes, and bring relevant perspective in your communities — not to replace human judgment or replace your communities themselves.

We ship carefully, listen to organisers and members, and treat trust as the product.`

export type AboutHowCard = {
  id: string
  title: string
  description: string
}

export type AboutPillar = {
  id: string
  label: string
  subtitle: string
  cards: AboutHowCard[]
}

export const ABOUT_HOW_IT_WORKS: AboutPillar[] = [
  {
    id: 'communities',
    label: 'Communities',
    subtitle: 'Create, invite, post',
    cards: [
      {
        id: 'create_community',
        title: 'Create a community',
        description: 'Start an invitation-only space for your group.',
      },
      {
        id: 'invite_members',
        title: 'Invite people',
        description: 'Bring members in through invites — no open directory.',
      },
      {
        id: 'engagement_posts',
        title: 'Engagement & posts',
        description: 'Posts, media, replies, and highlights in one place.',
      },
    ],
  },
  {
    id: 'dmsGroups',
    label: 'DMs & group chats',
    subtitle: 'Private conversations',
    cards: [
      {
        id: 'direct_messages',
        title: 'Direct messages',
        description: 'One-to-one chats outside the feed.',
      },
      {
        id: 'group_chats',
        title: 'Group chats',
        description: 'Smaller side conversations alongside a community.',
      },
    ],
  },
  {
    id: 'steve',
    label: 'Steve',
    subtitle: 'Built-in help',
    cards: [
      {
        id: 'steve_dm',
        title: 'Message Steve',
        description: 'Ask product questions or get a second opinion.',
      },
      {
        id: 'steve_in_feed',
        title: 'Steve in the feed',
        description: 'Tag Steve or use summaries where your plan allows.',
      },
      {
        id: 'steve_summaries',
        title: 'Summaries & voice',
        description: 'Condense long threads and voice notes when available.',
      },
    ],
  },
]
