import { useEffect } from 'react'
import { useHeader } from '../contexts/HeaderContext'

export default function SubscriptionPlans() {
  const { setTitle } = useHeader()

  useEffect(() => {
    setTitle('Subscription Plans')
  }, [setTitle])

  return (
    <div className="min-h-screen bg-black text-white pt-16 pb-12">
      <div className="mx-auto flex max-w-lg flex-col items-center justify-center px-4 pt-20">
        {/* Icon */}
        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#4db6ac]/20 to-[#4db6ac]/5 flex items-center justify-center mb-6">
          <svg 
            className="w-10 h-10 text-[#4db6ac]" 
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path 
              strokeLinecap="round" 
              strokeLinejoin="round" 
              strokeWidth={1.5} 
              d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" 
            />
          </svg>
        </div>

        {/* Title */}
        <h2 className="text-2xl font-bold text-white mb-3 text-center">
          Subscriptions Coming Soon
        </h2>

        {/* Description */}
        <p className="text-white/60 text-center mb-8 leading-relaxed">
          We're working on exciting subscription plans that will unlock premium features and enhance your C-Point experience. Stay tuned!
        </p>

        {/* Features Preview */}
        <div className="w-full rounded-2xl border border-white/10 bg-white/5 p-6">
          <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-[#4db6ac] mb-4">
            What to expect
          </h3>
          <ul className="space-y-3 text-sm text-white/80">
            <li className="flex items-start gap-3">
              <span className="mt-1.5 inline-block h-1.5 w-1.5 rounded-full bg-[#4db6ac]" />
              <span>AI-powered features to enhance your experience</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-1.5 inline-block h-1.5 w-1.5 rounded-full bg-[#4db6ac]" />
              <span>Expanded community sizes and features</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-1.5 inline-block h-1.5 w-1.5 rounded-full bg-[#4db6ac]" />
              <span>Premium badges and exclusive perks</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-1.5 inline-block h-1.5 w-1.5 rounded-full bg-[#4db6ac]" />
              <span>Priority support and early access to new features</span>
            </li>
          </ul>
        </div>

        {/* Contact */}
        <p className="mt-8 text-sm text-white/40 text-center">
          Have questions? Contact us at{' '}
          <a 
            href="mailto:hello@c-point.co" 
            className="text-[#4db6ac] hover:underline"
          >
            hello@c-point.co
          </a>
        </p>
      </div>
    </div>
  )
}
