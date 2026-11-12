import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Mono, PageHeader, QueryView, Tag } from '@/components/common'
import { columnHelper, DataTable } from '@/components/data-table'
import { DetailSheet } from '@/components/detail-sheet'
import { PlanViewer } from '@/components/viewers'
import { type client, q, type Res } from '@/lib/api'
import { ago, bytes } from '@/lib/format'

export const Route = createFileRoute('/plans')({
  component: Plans,
  validateSearch: (s: Record<string, unknown>): { open?: string } =>
    typeof s.open === 'string' ? { open: s.open } : {},
})

type Plan = Res<typeof client.api.plans.$get>['plans'][number]

const h = columnHelper<Plan>()
const columns = [
  h.accessor('title', {
    header: 'Plan',
    cell: ({ row: { original: p } }) => (
      <div className="max-w-2xl min-w-0">
        <div className="font-medium">
          {p.title} {p.agentId ? <Tag tone="agents">subagent</Tag> : null}
        </div>
        <Mono>{p.slug}</Mono>
      </div>
    ),
  }),
  h.accessor('modifiedAt', {
    header: 'Modified',
    cell: i => <span className="whitespace-nowrap">{ago(i.getValue())}</span>,
  }),
  h.accessor(r => r.sessionTitle ?? '', {
    id: 'session',
    header: 'Session',
    cell: ({ row: { original: p } }) =>
      p.sessionId ? (
        <Link
          to="/sessions/$id"
          params={{ id: p.sessionId }}
          className="line-clamp-2 max-w-xs hover:underline"
          onClick={e => e.stopPropagation()}
        >
          {p.sessionTitle ?? p.sessionId}
        </Link>
      ) : (
        <span className="text-muted-foreground">transcript deleted</span>
      ),
  }),
  h.accessor('bytes', { header: 'Size', cell: i => bytes(i.getValue()) }),
]

function Plans() {
  const query = useQuery(q.plans())
  const { open } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const selected = query.data?.plans.find(p => p.slug === open)
  return (
    <>
      <PageHeader
        title="Plans"
        description="Plans written in plan mode (~/.claude/plans), linked to the session that wrote them."
      />
      <QueryView query={query}>
        {data => (
          <DataTable
            data={data.plans}
            columns={columns}
            searchText={p => `${p.title} ${p.slug} ${p.sessionTitle ?? ''}`}
            initialSort={[{ id: 'modifiedAt', desc: true }]}
            onRowClick={p => void navigate({ search: { open: p.slug } })}
          />
        )}
      </QueryView>
      <DetailSheet open={!!open} onClose={() => void navigate({ search: {} })} title={selected?.title ?? open ?? ''}>
        {open ? <PlanViewer slug={open} /> : null}
      </DetailSheet>
    </>
  )
}
