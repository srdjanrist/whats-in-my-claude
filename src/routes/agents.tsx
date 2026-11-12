import { useQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { PageHeader, QueryView, Tag } from '@/components/common'
import { columnHelper, DataTable } from '@/components/data-table'
import { DetailSheet } from '@/components/detail-sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AgentViewer } from '@/components/viewers'
import { type client, q, type Res } from '@/lib/api'

type Tab = 'agents' | 'commands'

export const Route = createFileRoute('/agents')({
  component: Agents,
  validateSearch: (s: Record<string, unknown>): { tab?: Tab; open?: string } => ({
    ...(s.tab === 'commands' ? { tab: 'commands' as const } : {}),
    ...(typeof s.open === 'string' ? { open: s.open } : {}),
  }),
})

type Data = Res<typeof client.api.agents.$get>
type Agent = Data['agents'][number]
type Command = Data['commands'][number]

const owner = (source: string, o: string | null) => (
  <div className="space-y-0.5">
    <Tag tone={source}>{source}</Tag>
    {o ? <div className="max-w-56 truncate font-mono text-[10px] text-muted-foreground">{o}</div> : null}
  </div>
)

const ha = columnHelper<Agent>()
const agentColumns = [
  ha.accessor('name', {
    header: 'Agent',
    cell: ({ row: { original: a } }) => (
      <div className="max-w-2xl min-w-0">
        <div className="flex items-center gap-2 font-medium">
          {a.color ? <span className="size-2 rounded-full" style={{ background: a.color }} /> : null}
          {a.name}
        </div>
        <div className="line-clamp-2 text-[11px] text-muted-foreground">{a.description}</div>
      </div>
    ),
  }),
  ha.accessor('source', { header: 'Source', cell: ({ row: { original: a } }) => owner(a.source, a.owner) }),
  ha.accessor(r => r.model ?? 'inherit', { id: 'model', header: 'Model' }),
  ha.accessor(r => r.tools.length, {
    id: 'tools',
    header: 'Tools',
    cell: ({ row: { original: a } }) =>
      a.tools.length ? <span className="line-clamp-2 font-mono text-[10px]">{a.tools.join(', ')}</span> : 'all',
  }),
]

const hc = columnHelper<Command>()
const commandColumns = [
  hc.accessor('name', {
    header: 'Command',
    cell: ({ row: { original: c } }) => (
      <div className="max-w-2xl min-w-0">
        <div className="font-mono font-medium">
          {c.name}
          {c.argumentHint ? <span className="font-normal text-muted-foreground"> {c.argumentHint}</span> : null}
        </div>
        <div className="line-clamp-2 text-[11px] text-muted-foreground">{c.description}</div>
      </div>
    ),
  }),
  hc.accessor('source', { header: 'Source', cell: ({ row: { original: c } }) => owner(c.source, c.owner) }),
  hc.accessor(r => r.allowedTools.length, {
    id: 'tools',
    header: 'Allowed tools',
    cell: ({ row: { original: c } }) =>
      c.allowedTools.length ? (
        <span className="line-clamp-2 font-mono text-[10px]">{c.allowedTools.join(', ')}</span>
      ) : (
        '—'
      ),
  }),
]

function Agents() {
  const query = useQuery(q.agents())
  const { tab = 'agents', open } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const selected = query.data?.agents.find(a => a.id === open) ?? query.data?.commands.find(c => c.id === open)
  return (
    <>
      <PageHeader
        title="Agents & commands"
        description="Subagent definitions and slash commands from ~/.claude, installed plugins and your projects' .claude folders."
      />
      <QueryView query={query}>
        {data => (
          <Tabs value={tab} onValueChange={v => void navigate({ search: { tab: v as Tab } })}>
            <TabsList>
              <TabsTrigger value="agents">Agents ({data.agents.length})</TabsTrigger>
              <TabsTrigger value="commands">Commands ({data.commands.length})</TabsTrigger>
            </TabsList>
            <TabsContent value="agents" className="pt-2">
              <DataTable
                data={data.agents}
                columns={agentColumns}
                searchText={a => `${a.name} ${a.description ?? ''} ${a.owner ?? ''}`}
                onRowClick={a => void navigate({ search: { tab, open: a.id } })}
                initialSort={[{ id: 'source', desc: false }]}
              />
            </TabsContent>
            <TabsContent value="commands" className="pt-2">
              <DataTable
                data={data.commands}
                columns={commandColumns}
                searchText={c => `${c.name} ${c.description ?? ''} ${c.owner ?? ''}`}
                onRowClick={c => void navigate({ search: { tab, open: c.id } })}
                initialSort={[{ id: 'source', desc: false }]}
              />
            </TabsContent>
          </Tabs>
        )}
      </QueryView>
      <DetailSheet
        open={!!open}
        onClose={() => void navigate({ search: { tab } })}
        title={selected?.name ?? ''}
        description={selected?.description}
      >
        {open ? <AgentViewer id={open} /> : null}
      </DetailSheet>
    </>
  )
}
