import { useParams } from 'react-router-dom'
import MediaGalleryPage from '../chat/MediaGalleryPage'

export default function GroupChatMedia() {
  const { group_id } = useParams()
  return <MediaGalleryPage mode={{ type: 'group', groupId: group_id || '' }} />
}
