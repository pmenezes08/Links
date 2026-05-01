/** Stable slot ids — must match backend about_tutorials.ALLOWED_SLOTS */

export const ABOUT_CPOINT_VERSION_LABEL = '2.4.2'

export const MANIFESTO_SUMMARY_PARAS: string[] = [
  'C-Point was built on a simple principle: the world is meant to be lived — reconnect with your people in invitation-only communities, with no public feeds or algorithmic noise.',
  'Steve lives inside every community as an intelligent presence; everything shared stays inside until you choose otherwise.',
]

export const MANIFESTO_FULL = `C-Point Manifesto

C-Point was built on a simple principle: The world is meant to be lived. Come here to reconnect with your people, stay present in your world, and actually get back to living.

C-Point is a global platform of private, independent communities.
No public feeds. No self-promotion. No algorithm-driven noise. No fast-consuming content.

A community can be anything — a close group of friends planning trips, a circle debating the future, a place for banter with people who truly get you, or the private network that keeps you connected to the organisations that matter: your alumni group, your school, an investor network, your sports club, or your company.

Inside every community lives Steve — our intelligent presence who deeply understands each member's journey, values and expertise, and quietly works to create meaningful connections and keep the space alive.

Access is by invitation only. Privacy and exclusivity are built in from day one. Everything shared inside stays inside. No strangers. No algorithms deciding what deserves your attention.

This is your world. Come connect with it.`

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
