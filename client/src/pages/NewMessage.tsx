import { useEffect } from 'react'
import ParentCommunityPicker from '../components/ParentCommunityPicker'
import { useHeader } from '../contexts/HeaderContext'

export default function NewMessage(){
  const { setTitle } = useHeader()
  useEffect(() => { setTitle('New Message') }, [setTitle])

  return (
    <div className="fixed inset-x-0 top-14 bottom-0 bg-black text-white overflow-y-auto">
      <div className="max-w-3xl mx-auto px-3 py-3">
        <ParentCommunityPicker title="Select a Community" />
      </div>
    </div>
  )
}