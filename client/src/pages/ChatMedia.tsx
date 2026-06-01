import { useParams } from 'react-router-dom'
import MediaGalleryPage from '../chat/MediaGalleryPage'

export default function ChatMedia() {
  const { username } = useParams()
  return <MediaGalleryPage mode={{ type: 'dm', peer: username || '' }} />
}
