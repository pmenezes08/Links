import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import ParentCommunityPicker from '../components/ParentCommunityPicker'
import { useHeader } from '../contexts/HeaderContext'

export default function NewMessage(){
  const { t } = useTranslation()
  const { setTitle } = useHeader()
  useEffect(() => { setTitle(t('chat.new_message_title')) }, [setTitle, t])

  return (
    <div className="fixed inset-x-0 top-14 bottom-0 bg-black text-white overflow-y-auto">
      <div className="max-w-3xl mx-auto px-3 py-3">
        <ParentCommunityPicker title={t('chat.select_community_title')} />
      </div>
    </div>
  )
}
