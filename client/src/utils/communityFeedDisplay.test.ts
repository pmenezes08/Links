import { describe, expect, it } from 'vitest'
import {
  INTRO_THREAD_CARD_KEY,
  buildFeedDisplayPosts,
} from './communityFeedDisplay'

describe('buildFeedDisplayPosts', () => {
  it('removes introduce-yourself thread from the main timeline', () => {
    const result = buildFeedDisplayPosts(
      [
        {
          id: 1,
          username: 'steve',
          content: 'Introduce yourself',
          is_system_post: 1,
          welcome_card_key: INTRO_THREAD_CARD_KEY,
        },
        {
          id: 2,
          username: 'owner',
          content: 'Welcome',
          is_system_post: 0,
        },
      ],
      'owner',
    )

    expect(result.posts.some((post) => post.welcome_card_key === INTRO_THREAD_CARD_KEY)).toBe(false)
    expect(result.ownerHasPosted).toBe(true)
  })

  it('pins the owner post above Steve scaffolding in young communities', () => {
    const result = buildFeedDisplayPosts(
      [
        {
          id: 1,
          username: 'steve',
          content: 'Guide',
          is_system_post: 1,
          welcome_card_key: 'welcome.root',
        },
        {
          id: 2,
          username: 'owner',
          content: 'Owner welcome',
          is_system_post: 0,
        },
        {
          id: 3,
          username: 'steve',
          content: 'Poll',
          is_system_post: 1,
          welcome_card_key: 'cold_start.poll.v1',
          poll: { id: 9 },
        },
      ],
      'owner',
    )

    expect(result.posts[0]?.id).toBe(2)
  })

  it('hides the Steve poll when the owner post already asks a question', () => {
    const result = buildFeedDisplayPosts(
      [
        {
          id: 1,
          username: 'owner',
          content: 'What are you working on this week?',
          is_system_post: 0,
        },
        {
          id: 2,
          username: 'steve',
          content: 'Poll',
          is_system_post: 1,
          welcome_card_key: 'cold_start.poll.v1',
          poll: { id: 9 },
        },
      ],
      'owner',
    )

    expect(result.posts.some((post) => post.welcome_card_key === 'cold_start.poll.v1')).toBe(false)
  })
})
