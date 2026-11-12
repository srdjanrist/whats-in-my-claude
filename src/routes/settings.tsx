import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { Dot, Empty, KeyValues, Mono, PageHeader, QueryView, Section, Tag } from '@/components/common'
import { columnHelper, DataTable } from '@/components/data-table'
import { JsonView } from '@/components/markdown'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { type client, q, type Res } from '@/lib/api'

export const Route = createFileRoute('/settings')({ component: Settings })

type Data = Res<typeof client.api.settings.$get>
type Rule = Data['permissions']['rules'][number]

const h = columnHelper<Rule>()
const columns = [
  h.accessor('rule', { header: 'Rule', cell: i => <Mono className="break-all text-foreground">{i.getValue()}</Mono> }),
  h.accessor('kind', {
    header: 'Kind',
    cell: i => (
      <Tag tone={i.getValue() === 'allow' ? 'plugin' : i.getValue() === 'deny' ? 'security' : 'warning'}>
        {i.getValue()}
      </Tag>
    ),
  }),
  h.accessor('tool', { header: 'Tool', cell: i => <Mono>{i.getValue()}</Mono> }),
  h.accessor(r => r.projects.length, {
    id: 'projects',
    header: 'Where',
    cell: ({ row: { original: r } }) => (
      <span title={r.projects.join('\n')}>
        {r.projects.length === 1 ? <Mono>{r.projects[0]}</Mono> : `${r.projects.length} files`}
      </span>
    ),
  }),
]

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

function UserSettings({ content }: { content: unknown }) {
  if (!isObj(content)) return <Empty>Not found.</Empty>
  const permissions = isObj(content.permissions) ? content.permissions : {}
  const plugins = isObj(content.enabledPlugins) ? content.enabledPlugins : {}
  const autoMode = isObj(content.autoMode) ? content.autoMode : {}
  const hooks = isObj(content.hooks) ? content.hooks : {}
  const shown = new Set(['permissions', 'enabledPlugins', 'autoMode', 'hooks'])
  const rest = Object.fromEntries(Object.entries(content).filter(([k]) => !shown.has(k)))
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : [])
  return (
    <div className="space-y-4">
      <KeyValues
        items={[
          ['default permission mode', String(permissions.defaultMode ?? 'default')],
          ['allow rules', list(permissions.allow).length],
          ['deny rules', list(permissions.deny).length],
          ['hook events', Object.keys(hooks).join(', ') || 'none'],
        ]}
      />
      <div className="space-y-1">
        <div className="text-[11px] text-muted-foreground">enabledPlugins</div>
        <div className="flex flex-wrap gap-2 text-xs">
          {Object.entries(plugins).map(([id, on]) => (
            <span key={id} className="flex items-center gap-1.5">
              <Dot on={on === true} /> {id}
            </span>
          ))}
        </div>
      </div>
      {Object.keys(autoMode).length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {(['soft_deny', 'environment'] as const).map(k =>
            list(autoMode[k]).length ? (
              <div key={k} className="space-y-1">
                <div className="text-[11px] text-muted-foreground">autoMode.{k}</div>
                <ul className="max-h-64 list-disc space-y-1 overflow-y-auto pl-4 text-xs">
                  {list(autoMode[k]).map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            ) : null,
          )}
        </div>
      ) : null}
      <div className="space-y-1">
        <div className="text-[11px] text-muted-foreground">other settings</div>
        <JsonView value={rest} />
      </div>
    </div>
  )
}

function Settings() {
  const query = useQuery(q.settings())
  const [kind, setKind] = useState<'all' | 'allow' | 'deny' | 'ask'>('all')
  const rules = useMemo(
    () => (query.data?.permissions.rules ?? []).filter(r => kind === 'all' || r.kind === kind),
    [query.data, kind],
  )
  return (
    <>
      <PageHeader
        title="Settings"
        description="User-level settings files (secret-looking values are masked) and every permission rule across your projects."
      />
      <QueryView query={query}>
        {data => {
          const [user, ...others] = data.files
          return (
            <>
              <Section title="~/.claude/settings.json" description={user?.path}>
                <UserSettings content={user?.content} />
              </Section>
              <div className="grid gap-4 md:grid-cols-3">
                {others.map(f => (
                  <Section key={f.path} title={f.label} description={f.path}>
                    {f.content ? (
                      <JsonView value={f.content} className="max-h-72" />
                    ) : (
                      <p className="text-xs text-muted-foreground">{f.exists ? 'Unreadable.' : 'Not present.'}</p>
                    )}
                  </Section>
                ))}
              </div>
              <Section
                title="Permission rules"
                description={`${data.permissions.rules.length} distinct rules from ${data.permissions.filesScanned} settings files. ${data.permissions.defaultModes.length} files set a default mode.`}
              >
                <DataTable
                  data={rules}
                  columns={columns}
                  searchText={r => `${r.rule} ${r.projects.join(' ')}`}
                  initialSort={[{ id: 'projects', desc: true }]}
                  dense
                  toolbar={
                    <ToggleGroup
                      value={[kind]}
                      onValueChange={v => v[0] && setKind(v[0] as typeof kind)}
                      variant="outline"
                      size="sm"
                    >
                      {(['all', 'allow', 'deny', 'ask'] as const).map(k => (
                        <ToggleGroupItem key={k} value={k}>
                          {k}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                  }
                />
              </Section>
              {data.permissions.additionalDirectories.length ? (
                <Section
                  title="Additional directories"
                  description="Folders outside the project that sessions may read."
                >
                  <ul className="space-y-1 text-xs">
                    {data.permissions.additionalDirectories.map(d => (
                      <li key={d.path}>
                        <Mono>{d.path}</Mono> → {d.dirs.join(', ')}
                      </li>
                    ))}
                  </ul>
                </Section>
              ) : null}
            </>
          )
        }}
      </QueryView>
    </>
  )
}
