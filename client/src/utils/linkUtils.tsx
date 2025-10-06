// Utility functions for detecting and handling links in post content
import React from 'react'

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
 * Renders text with clickable links (converts markdown links to HTML)
 */
export function renderTextWithLinks(text: string): React.ReactNode {
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
      <a
        key={match.index}
        href={fullUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[#4db6ac] hover:underline"
        onClick={(e) => e.stopPropagation()}
      >
        {displayText}
      </a>
    )
    
    lastIndex = match.index + match[0].length
  }
  
  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex))
  }
  
  return parts.length > 0 ? parts : text
}
