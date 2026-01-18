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
function SmartLink({ 
  href, 
  displayText, 
  onJoinCommunity 
}: { 
  href: string
  displayText: string
  onJoinCommunity?: (communityName: string, communityId: number) => void
}) {
  const navigate = useNavigate()
  const [processing, setProcessing] = useState(false)

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    // Landing page links (www.c-point.co) should open in browser
    if (isLandingPageLink(href)) {
      window.open(href, '_blank', 'noopener,noreferrer')
      return
    }

    // Check if this is an internal app.c-point.co link
    if (!isInternalLink(href)) {
      // External link - open normally
      window.open(href, '_blank', 'noopener,noreferrer')
      return
    }

    // Check for invite token
    const inviteToken = extractInviteToken(href)
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
    const internalPath = extractInternalPath(href)
    if (internalPath) {
      navigate(internalPath)
    }
  }

  return (
    <a
      href={href}
      onClick={handleClick}
      className={`text-[#4db6ac] hover:underline ${processing ? 'opacity-50 cursor-wait' : ''}`}
    >
      {displayText}
      {processing && <span className="ml-1 inline-block animate-spin">⏳</span>}
    </a>
  )
}

/**
 * Colorizes @mentions in an array of React nodes
 */
function colorizeMentions(nodes: React.ReactNode[]): React.ReactNode[] {
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
      if (start > last) { segs.push(n.slice(last, start)) }
      if (lead) { segs.push(lead) }
      segs.push(<span key={`men-${idx}-${start}`} className="text-[#4db6ac]">{full}</span>)
      last = start + lead.length + full.length
    }
    if (last < n.length) { segs.push(n.slice(last)) }
    out.push(...segs)
  })
  return out
}

/**
 * Preserves newlines in text by converting them to <br> elements
 */
function preserveNewlines(text: string): React.ReactNode[] {
  const parts = text.split(/\n/)
  const out: React.ReactNode[] = []
  parts.forEach((p, i) => {
    if (i > 0) out.push(<br key={`br-${i}-${p.length}-${Math.random()}`} />)
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
  shortenUrls: boolean = false
): React.ReactNode {
  if (!text) return null
  
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let sourceCounter = 0
  
  // Match both markdown links and plain URLs
  const combinedRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s]+)/g
  let match
  
  while ((match = combinedRegex.exec(text)) !== null) {
    // Add text before the link
    if (match.index > lastIndex) {
      const textBefore = text.substring(lastIndex, match.index)
      parts.push(...colorizeMentions(preserveNewlines(textBefore)))
    }
    
    let url: string
    let displayText: string
    
    if (match[1] && match[2]) {
      // Markdown link: [text](url)
      displayText = match[1]
      url = match[2]
    } else {
      // Plain URL
      url = match[0]
      if (shortenUrls) {
        sourceCounter++
        displayText = `[source${sourceCounter > 1 ? ` ${sourceCounter}` : ''}]`
      } else {
        displayText = url
      }
    }
    
    parts.push(
      <a
        key={`link-${match.index}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[#4db6ac] hover:underline"
        title={shortenUrls ? url : undefined}
      >
        {displayText}
      </a>
    )
    
    lastIndex = match.index + match[0].length
  }
  
  // Add remaining text
  if (lastIndex < text.length) {
    const remainingText = text.substring(lastIndex)
    parts.push(...colorizeMentions(preserveNewlines(remainingText)))
  }
  
  return parts.length > 0 ? <>{parts}</> : text
}

/**
 * Renders text with clickable links (converts markdown links to HTML)
 * Internal c-point.co links are handled within the app
 * Also colorizes @mentions
 */
export function renderTextWithLinks(
  text: string,
  onJoinCommunity?: (communityName: string, communityId: number) => void
): React.ReactNode {
  if (!text) return null
  
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  
  // Find all markdown links
  const markdownRegex = new RegExp(MARKDOWN_LINK_REGEX)
  let match
  
  while ((match = markdownRegex.exec(text)) !== null) {
    // Add text before the link (with mentions colorized)
    if (match.index > lastIndex) {
      const textBefore = text.substring(lastIndex, match.index)
      parts.push(...colorizeMentions(preserveNewlines(textBefore)))
    }
    
    // Add the link as a clickable element
    const displayText = match[1]
    const url = match[2]
    const fullUrl = url.startsWith('http') ? url : `https://${url}`
    
    parts.push(
      <SmartLink
        key={match.index}
        href={fullUrl}
        displayText={displayText}
        onJoinCommunity={onJoinCommunity}
      />
    )
    
    lastIndex = match.index + match[0].length
  }
  
  // Add remaining text (with mentions colorized)
  if (lastIndex < text.length) {
    const remainingText = text.substring(lastIndex)
    parts.push(...colorizeMentions(preserveNewlines(remainingText)))
  }
  
  return parts.length > 0 ? parts : text
}
