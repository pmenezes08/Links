// Utility functions for detecting and handling links in post content
import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { isInternalLink, isLandingPageLink, extractInviteToken, extractInternalPath, joinCommunityWithInvite } from './internalLinkHandler'

export type DetectedLink = {
  url: string
  displayText: string
  startIndex: number
  endIndex: number
}

// Regex to match URLs (including those with markdown format)
const URL_REGEX = /(?:https?:\/\/)?(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&\/=]*)/gi

// Regex to match markdown-style links: [text](url)
const MARKDOWN_LINK_REGEX = /\[([^\]]+)\]\(([^)]+)\)/g

/**
 * Detects all URLs in text (both plain URLs and markdown-formatted links)
 */
export function detectLinks(text: string): DetectedLink[] {
  const links: DetectedLink[] = []
  
  // First, find markdown-formatted links
  let match
  const markdownRegex = new RegExp(MARKDOWN_LINK_REGEX)
  while ((match = markdownRegex.exec(text)) !== null) {
    links.push({
      url: match[2],
      displayText: match[1],
      startIndex: match.index,
      endIndex: match.index + match[0].length,
    })
  }
  
  // Then find plain URLs that aren't already part of markdown links
  const urlRegex = new RegExp(URL_REGEX)
  while ((match = urlRegex.exec(text)) !== null) {
    const matchStart = match.index
    const matchEnd = match.index + match[0].length
    
    // Check if this URL is already part of a markdown link
    const isPartOfMarkdown = links.some(
      link => matchStart >= link.startIndex && matchEnd <= link.endIndex
    )
    
    if (!isPartOfMarkdown) {
      links.push({
        url: match[0],
        displayText: match[0],
        startIndex: matchStart,
        endIndex: matchEnd,
      })
    }
  }
  
  return links.sort((a, b) => a.startIndex - b.startIndex)
}

/**
 * Converts plain URLs to markdown format
 */
export function urlToMarkdown(url: string, displayText: string): string {
  return `[${displayText}](${url})`
}

/**
 * Replaces a plain URL in text with markdown format
 */
export function replaceLinkInText(text: string, oldUrl: string, newDisplayText: string): string {
  const markdown = urlToMarkdown(oldUrl, newDisplayText)
  return text.replace(oldUrl, markdown)
}

/**
 * Smart link component that handles internal c-point.co links within the app
 */
export function SmartLink({ 
  href, 
  displayText, 
  onJoinCommunity,
  onExternalClick,
  linkClassName,
}: { 
  href: string
  displayText: string
  onJoinCommunity?: (communityName: string, communityId: number) => void
  onExternalClick?: (url: string) => void
  /** Extra classes for the anchor (e.g. smaller text in SOURCES block). */
  linkClassName?: string
}) {
  const navigate = useNavigate()
  const [processing, setProcessing] = useState(false)

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    let resolvedHref = href
    if (href.startsWith('/') && !href.startsWith('//')) {
      resolvedHref =
        typeof window !== 'undefined'
          ? `${window.location.origin}${href}`
          : `https://app.c-point.co${href}`
    }

    // Landing page links (www.c-point.co) should open in browser
    if (isLandingPageLink(resolvedHref)) {
      window.open(resolvedHref, '_blank', 'noopener,noreferrer')
      return
    }

    // Check if this is an internal app.c-point.co link
    if (!isInternalLink(resolvedHref)) {
      // External link - prefer in-platform article reader for roundups/news if provided
      if (onExternalClick) {
        onExternalClick(resolvedHref)
        return
      }
      // Fallback to new tab
      window.open(resolvedHref, '_blank', 'noopener,noreferrer')
      return
    }

    // Check for invite token
    const inviteToken = extractInviteToken(resolvedHref)
    if (inviteToken) {
      setProcessing(true)
      try {
        const result = await joinCommunityWithInvite(inviteToken)
        
        if (result.success && result.communityId) {
          // Successfully joined - show success and navigate
          if (onJoinCommunity && result.communityName) {
            onJoinCommunity(result.communityName, result.communityId)
          }
          navigate(`/community_feed_react/${result.communityId}`)
        } else if (result.alreadyMember && result.communityId) {
          // Already a member - just navigate
          navigate(`/community_feed_react/${result.communityId}`)
        } else {
          // Show error as alert for now
          alert(result.error || 'Failed to join community')
        }
      } finally {
        setProcessing(false)
      }
      return
    }

    // Other internal link - navigate within the app
    const internalPath = extractInternalPath(resolvedHref)
    if (internalPath) {
      navigate(internalPath)
    }
  }

  return (
    <a
      href={href}
      onClick={handleClick}
      className={`text-[#4db6ac] underline inline py-0.5 break-all ${processing ? 'opacity-50 cursor-wait' : ''} ${linkClassName || ''}`}
      style={{ minHeight: '32px', lineHeight: '1.6' }}
    >
      {displayText}
      {processing && <span className="ml-1 inline-block animate-spin">⏳</span>}
    </a>
  )
}

/**
 * Converts **bold** markdown markers in string nodes to <strong> elements.
 */
export function applyBoldEmphasis(nodes: React.ReactNode[]): React.ReactNode[] {
  const out: React.ReactNode[] = []
  nodes.forEach((node, i) => {
    if (typeof node !== 'string') { out.push(node); return }
    const parts = node.split(/\*\*(.+?)\*\*/g)
    if (parts.length === 1) { out.push(node); return }
    parts.forEach((part, j) => {
      if (!part) return
      if (j % 2 === 1) {
        out.push(<strong key={`b-${i}-${j}`} className="font-semibold">{part}</strong>)
      } else {
        out.push(part)
      }
    })
  })
  return out
}

/**
 * Replaces special tokens like [FA_STAR] with Font Awesome icons.
 * Used for roundup welcome messages to add a star after "Steve!".
 */
export function replaceFaIcons(nodes: React.ReactNode[]): React.ReactNode[] {
  const out: React.ReactNode[] = []
  nodes.forEach((node, i) => {
    if (typeof node !== 'string') { out.push(node); return }
    const parts = node.split(/(\[FA_STAR\])/g)
    if (parts.length === 1) { out.push(node); return }
    parts.forEach((part, j) => {
      if (!part) return
      if (part === '[FA_STAR]') {
        out.push(<i key={`fa-${i}-${j}`} className="fa-solid fa-star text-yellow-400 ml-1 align-middle" />)
      } else {
        out.push(part)
      }
    })
  })
  return out
}

/**
 * Colorizes @mentions in an array of React nodes.
 * When onMentionClick is provided, mentions become clickable (e.g. navigate to public profile).
 */
export function colorizeMentions(nodes: React.ReactNode[], onMentionClick?: (username: string) => void): React.ReactNode[] {
  const out: React.ReactNode[] = []
  const mentionRe = /(^|\s)(@([a-zA-Z0-9_]{1,30}))/g
  nodes.forEach((n, idx) => {
    if (typeof n !== 'string') { out.push(n); return }
    const segs: React.ReactNode[] = []
    let last = 0
    let m: RegExpExecArray | null
    while ((m = mentionRe.exec(n))) {
      const start = m.index
      const lead = m[1]
      const full = m[2]
      const username = m[3]
      if (start > last) { segs.push(n.slice(last, start)) }
      if (lead) { segs.push(lead) }
      if (onMentionClick) {
        segs.push(
          <span
            key={`men-${idx}-${start}`}
            className="text-[#4db6ac] cursor-pointer hover:underline"
            onClick={(e) => { e.stopPropagation(); onMentionClick(username) }}
            role="link"
            tabIndex={0}
          >{full}</span>
        )
      } else {
        segs.push(<span key={`men-${idx}-${start}`} className="text-[#4db6ac]">{full}</span>)
      }
      last = start + lead.length + full.length
    }
    if (last < n.length) { segs.push(n.slice(last)) }
    out.push(...segs)
  })
  return out
}

/**
 * Preserves newlines in text by converting them to <br> elements.
 * Pass a stable `keyPrefix` unique per segment when multiple segments are merged into one parent (avoids duplicate React keys).
 */
export function preserveRichTextNewlines(text: string, keyPrefix: string | number = '0'): React.ReactNode[] {
  const parts = text.split(/\n/)
  const out: React.ReactNode[] = []
  const prefix = String(keyPrefix)
  parts.forEach((p, i) => {
    if (i > 0) out.push(<br key={`br-${prefix}-${i}`} />)
    if (p) out.push(p)
  })
  return out
}

/**
 * Renders text with clickable links, optionally shortening URLs to "[source]"
 * Useful for AI-generated content with citations
 */
export function renderTextWithSourceLinks(
  text: string,
  shortenUrls: boolean = false,
  onMentionClick?: (username: string) => void,
  onExternalClick?: (url: string) => void,
): React.ReactNode {
  if (!text) return null
  
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let sourceCounter = 0
  
  // Match markdown links ([text](url) path or https), https/http URLs, and www. URLs
  const combinedRegex = /\[([^\]]+)\]\(([^)]+)\)|(https?:\/\/[^\s]+)|(?:^|\s)(www\.[^\s]+)/g
  let match

  while ((match = combinedRegex.exec(text)) !== null) {
    // For www. matches the full match may include a leading space; adjust start index
    const wwwUrl = match[4]
    const effectiveStart = wwwUrl ? match.index + (match[0].length - wwwUrl.length) : match.index

    if (effectiveStart > lastIndex) {
      const textBefore = text.substring(lastIndex, effectiveStart)
      parts.push(...colorizeMentions(replaceFaIcons(applyBoldEmphasis(preserveRichTextNewlines(textBefore, lastIndex))), onMentionClick))
    }

    let url: string
    let displayText: string

    if (match[1] && match[2]) {
      displayText = match[1]
      url = match[2].trim()
    } else if (wwwUrl) {
      displayText = wwwUrl
      url = `https://${wwwUrl}`
    } else {
      url = match[0]
      if (shortenUrls) {
        sourceCounter++
        displayText = `[source${sourceCounter > 1 ? ` ${sourceCounter}` : ''}]`
      } else {
        displayText = url
      }
    }
    
    parts.push(
      <SmartLink
        key={`link-${effectiveStart}`}
        href={url}
        displayText={displayText}
        onExternalClick={onExternalClick}
      />,
    )
    
    lastIndex = match.index + match[0].length
  }
  
  if (lastIndex < text.length) {
    const remainingText = text.substring(lastIndex)
    parts.push(...colorizeMentions(replaceFaIcons(applyBoldEmphasis(preserveRichTextNewlines(remainingText, lastIndex))), onMentionClick))
  }
  
  return parts.length > 0 ? <>{parts}</> : text
}

/** Structured news roundups end with a SOURCES block (see render_sources_section). */
export const SOURCES_BLOCK_MARKER = '\nSOURCES\n'

/**
 * Markdown links, plain URLs, optional SOURCES block; uses SmartLink for external in-app handling.
 */
export function renderRichText(
  input: string,
  shortenUrls: boolean = false,
  onMentionClick?: (username: string) => void,
  onArticleOpen?: (url: string) => void,
  markdownLinkClassName?: string,
): React.ReactNode {
  if (!markdownLinkClassName && input.includes(SOURCES_BLOCK_MARKER)) {
    const idx = input.indexOf(SOURCES_BLOCK_MARKER)
    return (
      <>
        {renderRichText(
          input.slice(0, idx),
          shortenUrls,
          onMentionClick,
          onArticleOpen,
          undefined,
        )}
        <br />
        <span className="font-semibold">SOURCES</span>
        <br />
        {renderRichText(
          input.slice(idx + SOURCES_BLOCK_MARKER.length),
          shortenUrls,
          onMentionClick,
          onArticleOpen,
          'text-[10px]',
        )}
      </>
    )
  }

  const nodes: Array<React.ReactNode> = []
  const markdownRe = /\[([^\]]+)\]\(([^)]+)\)/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let sourceCounter = 0
  while ((match = markdownRe.exec(input))) {
    if (match.index > lastIndex) {
      nodes.push(
        ...colorizeMentions(
          replaceFaIcons(
            applyBoldEmphasis(preserveRichTextNewlines(input.slice(lastIndex, match.index), lastIndex)),
          ),
          onMentionClick,
        ),
      )
    }
    const label = match[1]
    const url = match[2].trim()
    nodes.push(
      <SmartLink
        key={`md-${match.index}`}
        href={url}
        displayText={label}
        onExternalClick={onArticleOpen}
        linkClassName={markdownLinkClassName}
      />,
    )
    lastIndex = markdownRe.lastIndex
  }
  const rest = input.slice(lastIndex)
  const urlRe = /(https?:\/\/[^\s]+|www\.[^\s]+)/g
  let urlLast = 0
  let m: RegExpExecArray | null
  while ((m = urlRe.exec(rest))) {
    if (m.index > urlLast) {
      nodes.push(
        ...colorizeMentions(
          replaceFaIcons(applyBoldEmphasis(preserveRichTextNewlines(rest.slice(urlLast, m.index), lastIndex + urlLast))),
          onMentionClick,
        ),
      )
    }
    const urlText = m[0]
    const href = urlText.startsWith('http') ? urlText : `https://${urlText}`
    if (shortenUrls) {
      sourceCounter++
      nodes.push(
        <SmartLink
          key={`u-${lastIndex + m.index}`}
          href={href}
          displayText={`[source${sourceCounter > 1 ? ` ${sourceCounter}` : ''}]`}
          onExternalClick={onArticleOpen}
          linkClassName={markdownLinkClassName}
        />,
      )
    } else {
      nodes.push(
        <SmartLink
          key={`u-${lastIndex + m.index}`}
          href={href}
          displayText={urlText}
          onExternalClick={onArticleOpen}
          linkClassName={markdownLinkClassName}
        />,
      )
    }
    urlLast = urlRe.lastIndex
  }
  if (urlLast < rest.length) {
    nodes.push(
      ...colorizeMentions(
        replaceFaIcons(applyBoldEmphasis(preserveRichTextNewlines(rest.slice(urlLast), lastIndex + urlLast))),
        onMentionClick,
      ),
    )
  }
  return <>{nodes}</>
}

function renderTextWithLinksInner(
  text: string,
  onJoinCommunity?: (communityName: string, communityId: number) => void,
  onMentionClick?: (username: string) => void,
  linkClassName?: string,
  onExternalClick?: (url: string) => void,
): React.ReactNode {
  if (!text) return null

  const parts: React.ReactNode[] = []
  let lastIndex = 0

  const markdownRegex = new RegExp(MARKDOWN_LINK_REGEX)
  let match

  while ((match = markdownRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const textBefore = text.substring(lastIndex, match.index)
      parts.push(...colorizeMentions(replaceFaIcons(applyBoldEmphasis(preserveRichTextNewlines(textBefore, lastIndex))), onMentionClick))
    }

    const displayText = match[1]
    const urlRaw = match[2]
    const hrefForLink =
      urlRaw.startsWith('/') && !urlRaw.startsWith('//')
        ? urlRaw
        : urlRaw.startsWith('http')
          ? urlRaw
          : `https://${urlRaw}`

    parts.push(
      <SmartLink
        key={match.index}
        href={hrefForLink}
        displayText={displayText}
        onJoinCommunity={onJoinCommunity}
        onExternalClick={onExternalClick}
        linkClassName={linkClassName}
      />,
    )

    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    const remainingText = text.substring(lastIndex)
    parts.push(...colorizeMentions(replaceFaIcons(applyBoldEmphasis(preserveRichTextNewlines(remainingText, lastIndex))), onMentionClick))
  }

  return parts.length > 0 ? parts : text
}

/**
 * Renders text with clickable links (converts markdown links to HTML)
 * Internal c-point.co links are handled within the app
 * Also colorizes @mentions
 */
export function renderTextWithLinks(
  text: string,
  onJoinCommunity?: (communityName: string, communityId: number) => void,
  onMentionClick?: (username: string) => void,
  options?: { sourcesSmallLinks?: boolean; onExternalClick?: (url: string) => void },
): React.ReactNode {
  if (!text) return null

  const onExternalClick = options?.onExternalClick

  if (options?.sourcesSmallLinks) {
    const idx = text.indexOf(SOURCES_BLOCK_MARKER)
    if (idx !== -1) {
      const before = text.slice(0, idx)
      const after = text.slice(idx + SOURCES_BLOCK_MARKER.length)
      return (
        <>
          {renderTextWithLinksInner(before, onJoinCommunity, onMentionClick, undefined, onExternalClick)}
          <br />
          <span className="font-semibold">SOURCES</span>
          <br />
          {renderTextWithLinksInner(after, onJoinCommunity, onMentionClick, 'text-[10px]', onExternalClick)}
        </>
      )
    }
  }

  return renderTextWithLinksInner(text, onJoinCommunity, onMentionClick, undefined, onExternalClick)
}
