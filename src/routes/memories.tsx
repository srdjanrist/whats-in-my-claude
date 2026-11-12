import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { PageHeader, QueryView, StatCard, Tag } from '@/components/common'
import { columnHelper, DataTable } from '@/components/data-table'
import { DetailSheet } from '@/components/detail-sheet'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { MemoryViewer } from '@/components/viewers'
import { type client, q, type Res } from '@/lib/api'
import { ago, bytes } from '@/lib/format'

export const Route = createFileRoute('/memories')({
  component: Memories,
  validateSearch: (s: Record<string, unknown>): { open?: string } =>
    typeof s.open === 'string' ? { open: s.open } : {},
})

type Data = Res<typeof client.api.memories.$get>
type Memory = Data['items'][number]

const h = columnHelper<Memory>()
const columns = [
  h.accessor('name', {
    header: 'Memory',
    cell: ({ row: { original: m } }) => (
      <div className="max-w-2xl min-w-0">
        <div className="font-medium">{m.name}</div>
        <div className="line-clamp-2 text-[11px] text-muted-foreground">{m.description}</div>
      </div>
    ),
  }),
  h.accessor(r => r.type ?? 'untyped', {
    id: 'type',
    header: 'Type',
    cell: i => <Tag tone={i.getValue()}>{i.getValue()}</Tag>,
  }),
  h.accessor('project', {
    header: 'Project',
    cell: ({ row: { original: m } }) => (
      <Link
        to="/projects/$id"
        params={{ id: m.projectId }}
        className="font-mono text-[11px] text-muted-foreground hover:underline"
        onClick={e => e.stopPropagation()}
      >
        {m.project}
      </Link>
    ),
  }),
  h.accessor(r => r.modified ?? 0, {
    id: 'modified',
    header: 'Modified',
    cell: i => <span className="whitespace-nowrap">{ago(i.getValue() || null)}</span>,
  }),
  h.accessor(r => r.links.length, {
    id: 'links',
    header: 'Links',
    cell: ({ row: { original: m } }) =>
      m.links.length ? (
        <span
          className={m.brokenLinks.length ? 'text-amber-600' : undefined}
          title={m.brokenLinks.length ? `unresolved: ${m.brokenLinks.join(', ')}` : m.links.join(', ')}
        >
          {m.links.length}
          {m.brokenLinks.length ? ` (${m.brokenLinks.length} unresolved)` : ''}
        </span>
      ) : (
        '—'
      ),
  }),
  h.accessor('inIndex', {
    header: 'In MEMORY.md',
    cell: i => (i.getValue() ? 'yes' : <span className="text-amber-600">no</span>),
  }),
  h.accessor('bytes', { header: 'Size', cell: i => bytes(i.getValue()) }),
]

const TYPES = ['all', 'project', 'feedback', 'reference', 'user'] as const

function Memories() {
  const query = useQuery(q.memories())
  const { open } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const [type, setType] = useState<(typeof TYPES)[number]>('all')
  const rows = useMemo(
    () => (query.data?.items ?? []).filter(m => type === 'all' || m.type === type),
    [query.data, type],
  )
  const [openProject, openFile] = open
    ? [open.slice(0, open.lastIndexOf('/')), open.slice(open.lastIndexOf('/') + 1)]
    : [null, null]
  return (
    <>
      <PageHeader
        title="Memories"
        description="Claude's auto-memory: one fact per file under ~/.claude/projects/<project>/memory, indexed by MEMORY.md."
      />
      <QueryView query={query}>
        {data => {
          const counts = Object.fromEntries(
            TYPES.map(t => [t, data.items.filter(m => t === 'all' || m.type === t).length]),
          )
          return (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <StatCard label="Memories" value={data.items.length} hint={`in ${data.dirs.length} projects`} />
                <StatCard label="Feedback" value={counts.feedback ?? 0} hint="how to work" />
                <StatCard
                  label="Index drift"
                  value={data.dirs.reduce((n, d) => n + d.orphans.length + d.dead.length, 0)}
                  hint="orphans + dead MEMORY.md entries"
                />
                <StatCard
                  label="Unresolved [[links]]"
                  value={data.items.reduce((n, m) => n + m.brokenLinks.length, 0)}
                  hint="links to memories not written yet"
                />
              </div>
              <DataTable
                data={rows}
                columns={columns}
                searchText={m => `${m.name} ${m.description ?? ''} ${m.project}`}
                searchPlaceholder="Filter memories…"
                initialSort={[{ id: 'modified', desc: true }]}
                onRowClick={m => void navigate({ search: { open: `${m.projectId}/${m.file}` } })}
                toolbar={
                  <ToggleGroup
                    value={[type]}
                    onValueChange={v => v[0] && setType(v[0] as typeof type)}
                    variant="outline"
                    size="sm"
                  >
                    {TYPES.map(t => (
                      <ToggleGroupItem key={t} value={t}>
                        {t} ({counts[t]})
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                }
              />
            </>
          )
        }}
      </QueryView>
      <DetailSheet
        open={!!open}
        onClose={() => void navigate({ search: {} })}
        title={openFile ?? ''}
        description={openProject}
      >
        {openProject && openFile ? <MemoryViewer projectId={openProject} file={openFile} /> : null}
      </DetailSheet>
    </>
  )
}
