import { useQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Link2 } from 'lucide-react'
import { Mono, PageHeader, QueryView, Tag } from '@/components/common'
import { columnHelper, DataTable } from '@/components/data-table'
import { DetailSheet } from '@/components/detail-sheet'
import { InstructionViewer } from '@/components/viewers'
import { type client, q, type Res } from '@/lib/api'
import { bytes } from '@/lib/format'

export const Route = createFileRoute('/instructions')({
  component: Instructions,
  validateSearch: (s: Record<string, unknown>): { open?: string } =>
    typeof s.open === 'string' ? { open: s.open } : {},
})

type File = Res<typeof client.api.instructions.$get>['files'][number]

const h = columnHelper<File>()
const columns = [
  h.accessor('displayPath', {
    header: 'File',
    cell: ({ row: { original: f } }) => (
      <div className="flex items-center gap-2">
        <Mono className="text-foreground">{f.displayPath}</Mono>
        {f.isSymlink ? <Link2 className="size-3 text-muted-foreground" /> : null}
      </div>
    ),
  }),
  h.accessor('kind', { header: 'Kind', cell: i => <Tag tone="project">{i.getValue()}</Tag> }),
  h.accessor('scope', {
    header: 'Scope',
    cell: i => <Tag tone={i.getValue() === 'global' ? 'user' : 'project'}>{i.getValue()}</Tag>,
  }),
  h.accessor('lines', { header: 'Lines' }),
  h.accessor('bytes', { header: 'Size', cell: i => bytes(i.getValue()) }),
  h.accessor(r => r.imports.length, {
    id: 'imports',
    header: 'Imports',
    cell: ({ row: { original: f } }) => (f.imports.length ? <Mono>{f.imports.map(i => `@${i}`).join(' ')}</Mono> : '—'),
  }),
]

function Instructions() {
  const query = useQuery(q.instructions())
  const { open } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  return (
    <>
      <PageHeader
        title="CLAUDE.md files"
        description="Instructions Claude reads at the start of a session: your global ~/.claude/CLAUDE.md and the CLAUDE.md / AGENTS.md / CLAUDE.local.md at the root of each project."
      />
      <QueryView query={query}>
        {data => (
          <DataTable
            data={data.files}
            columns={columns}
            searchText={f => f.displayPath}
            initialSort={[{ id: 'scope', desc: false }]}
            onRowClick={f => void navigate({ search: { open: f.path } })}
          />
        )}
      </QueryView>
      <DetailSheet
        open={!!open}
        onClose={() => void navigate({ search: {} })}
        title={open?.split('/').slice(-2).join('/') ?? ''}
      >
        {open ? <InstructionViewer path={open} /> : null}
      </DetailSheet>
    </>
  )
}
