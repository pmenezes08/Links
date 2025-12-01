// Utility functions for detecting and handling links in post content
import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { isInternalLink, extractInviteToken, extractInternalPath, joinCommunityWithInvite } from './internalLinkHandler'

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

    // Check if this is an internal c-point.co link
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
 * Renders text with clickable links (converts markdown links to HTML)
 * Internal c-point.co links are handled within the app
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
    // Add text before the link
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index))
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
  
  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex))
  }
  
  return parts.length > 0 ? parts : text
}
