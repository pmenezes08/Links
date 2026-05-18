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

/** Copy for the 4-step About C-Point modal (dashboard empty state). */
export const ABOUT_CPOINT_MODAL_COMMUNITY_FEEDS_INTRO =
  'Each community has its own private feed: posts, updates, events, polls and media stay inside that invitation-only network.'

export const ABOUT_CPOINT_MODAL_COMMUNITY_FEED_FEATURES: Array<{ icon: string; title: string; text: string }> = [
  { icon: 'fa-regular fa-comments', title: 'Posts', text: 'Updates and discussion threads.' },
  { icon: 'fa-solid fa-square-poll-vertical', title: 'Polls', text: 'Quick input from members.' },
  { icon: 'fa-regular fa-calendar', title: 'Events', text: "Create what's happening." },
  { icon: 'fa-regular fa-images', title: 'Media', text: 'Photos and files in context.' },
  { icon: 'fa-regular fa-address-book', title: 'Members', text: 'Connect with your community.' },
]

export const ABOUT_CPOINT_MODAL_DMS_PARAS: string[] = [
  'Beyond the feed, use one-to-one DMs and smaller group chats for side conversations, planning and coordination.',
  'They sit alongside your communities, so the relationships stay private and intentional.',
]

export const ABOUT_CPOINT_MODAL_STEVE_PARAS: string[] = [
  'Steve is C-Point’s built-in intelligent presence: an always-on member focused on making the platform easier to use.',
  'Ask Steve for product help, discussion context, or summaries where your plan allows.',
]

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
