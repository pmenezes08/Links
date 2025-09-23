import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useHeader } from '../contexts/HeaderContext'

type Post = {
    id: number
    image_path: string
    timestamp: string
}

export default function CommunityPhotos() {
    const { community_id } = useParams()
    const { setTitle } = useHeader()
    const [photos, setPhotos] = useState<Post[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        setTitle('Community Photos')
    }, [setTitle])

    useEffect(() => {
        if (!community_id) return

        setLoading(true)
        fetch(`/api/community_feed/${community_id}`, { credentials: 'include' })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    const photosWithImages = data.posts.filter((post: any) => post.image_path)
                    setPhotos(photosWithImages)
                }
            })
            .finally(() => setLoading(false))
    }, [community_id])

    // Fetch photos from the backend
    // I will implement this in the next step

    if (loading) {
        return <div className="p-4 text-white">Loading...</div>
    }

    const groupedPhotos = photos.reduce((acc, photo) => {
        const date = new Date(photo.timestamp).toLocaleDateString()
        if (!acc[date]) {
            acc[date] = []
        }
        acc[date].push(photo)
        return acc
    }, {} as Record<string, Post[]>)

    return (
        <div className="p-4 text-white">
            <h1 className="text-2xl font-bold mb-4">Community Photos</h1>
            {Object.entries(groupedPhotos).map(([date, photos]) => (
                <div key={date} className="mb-8">
                    <h2 className="text-xl font-semibold mb-4">{date}</h2>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                        {photos.map(photo => (
                            <div key={photo.id} className="aspect-square bg-gray-800 rounded-lg overflow-hidden">
                                <img src={photo.image_path} alt="Community photo" className="w-full h-full object-cover" />
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    )
}
