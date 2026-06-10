type FeedPost = {
  id: number
  username: string
  content: string
  is_system_post?: boolean | number | null
  welcome_card_key?: string | null
  poll?: unknown | null
}

export const INTRO_THREAD_CARD_KEY = 'cold_start.introduce_yourself.v1'
export const COLD_START_POLL_CARD_KEY = 'cold_start.poll.v1'
const WELCOME_CARD_PREFIX = 'welcome.'
const OWNER_PIN_USER_POST_THRESHOLD = 5

export function isIntroduceThreadPost(post: FeedPost): boolean {
  return post.welcome_card_key === INTRO_THREAD_CARD_KEY
}

export function isSteveWelcomePost(post: FeedPost): boolean {
  const key = post.welcome_card_key || ''
  return Boolean(post.is_system_post && key.startsWith(WELCOME_CARD_PREFIX))
}

export function isSteveColdStartPoll(post: FeedPost): boolean {
  return Boolean(
    post.is_system_post &&
    post.welcome_card_key === COLD_START_POLL_CARD_KEY &&
    post.poll,
  )
}

function isHumanPost(post: FeedPost): boolean {
  return !post.is_system_post && String(post.username || '').toLowerCase() !== 'steve'
}

export function buildFeedDisplayPosts(
  posts: FeedPost[],
  ownerUsername?: string | null,
): { posts: FeedPost[]; ownerHasPosted: boolean; userPostCount: number } {
  const owner = (ownerUsername || '').trim()
  const withoutIntroThread = posts.filter((post) => !isIntroduceThreadPost(post))
  const userPosts = withoutIntroThread.filter(isHumanPost)
  const ownerPosts = owner
    ? userPosts.filter((post) => String(post.username) === owner)
    : []
  const ownerHasPosted = ownerPosts.length > 0
  const ownerAskedQuestion = ownerPosts.some((post) => post.content.includes('?'))

  let filtered = withoutIntroThread
  if (ownerAskedQuestion) {
    filtered = filtered.filter((post) => !isSteveColdStartPoll(post))
  }

  if (userPosts.length < OWNER_PIN_USER_POST_THRESHOLD && ownerPosts.length > 0) {
    const ownerFirst = ownerPosts[0]
    const rest = filtered.filter((post) => post.id !== ownerFirst.id)
    const humanRest = rest.filter(isHumanPost)
    const systemRest = rest.filter((post) => !isHumanPost(post))
    filtered = [ownerFirst, ...humanRest, ...systemRest]
  }

  return {
    posts: filtered,
    ownerHasPosted,
    userPostCount: userPosts.length,
  }
}
