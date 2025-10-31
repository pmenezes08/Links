import type { GifSelection } from '../components/GifPicker'

export async function gifSelectionToFile(gif: GifSelection, prefix = 'cpoint-gif') {
  const response = await fetch(gif.url)
  if (!response.ok) throw new Error('Failed to download GIF asset')
  const blob = await response.blob()
  const mime = blob.type || 'image/gif'
  const extension = mime.split('/').pop() || 'gif'
  const filename = `${prefix}-${Date.now()}.${extension}`
  return new File([blob], filename, { type: mime })
}
