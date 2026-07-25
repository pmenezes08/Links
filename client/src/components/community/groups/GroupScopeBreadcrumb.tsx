import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import type { CommunityNode } from './types'

/**
 * Root→current ancestor path for the scoped community — the answer to
 * "where am I in the tree" that a 3-level network (TAP Air Portugal →
 * Pessoal Navegante → PNT) needs for wayfinding. Ancestors navigate;
 * beyond 3 levels the middle collapses to an ellipsis keeping
 * root + parent + current.
 */
export default function GroupScopeBreadcrumb({
  chain,
  onNavigate,
}: {
  chain: CommunityNode[]
  onNavigate: (communityId: number) => void
}) {
  const { t } = useTranslation()
  if (chain.length < 2) return null

  const collapsed: Array<CommunityNode | 'ellipsis'> =
    chain.length <= 3 ? chain : [chain[0], 'ellipsis', chain[chain.length - 2], chain[chain.length - 1]]

  return (
    <nav aria-label={t('communities.groups_breadcrumb_aria')} className="px-1 pb-2">
      <ol className="flex items-center gap-1 flex-wrap text-xs">
        {collapsed.map((item, i) => {
          const isLast = i === collapsed.length - 1
          if (item === 'ellipsis') {
            return (
              <Fragment key="ellipsis">
                <li aria-hidden className="text-c-text-disabled px-0.5">…</li>
                <li aria-hidden><i className="fa-solid fa-chevron-right text-[9px] text-c-text-disabled" /></li>
              </Fragment>
            )
          }
          return (
            <Fragment key={item.id}>
              <li aria-current={isLast ? 'page' : undefined}>
                {isLast ? (
                  <span className="text-c-text-primary font-medium">{item.name}</span>
                ) : (
                  <button
                    type="button"
                    className="text-c-text-tertiary hover:text-c-text-secondary underline-offset-2 min-h-[44px] inline-flex items-center px-1"
                    onClick={() => onNavigate(item.id)}
                  >
                    {item.name}
                  </button>
                )}
              </li>
              {!isLast && (
                <li aria-hidden><i className="fa-solid fa-chevron-right text-[9px] text-c-text-disabled" /></li>
              )}
            </Fragment>
          )
        })}
      </ol>
    </nav>
  )
}
