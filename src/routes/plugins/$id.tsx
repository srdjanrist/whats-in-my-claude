import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Dot, Empty, ErrorState, KeyValues, Mono, PageHeader, QueryView, Section, Tag } from '@/components/common'
import { q } from '@/lib/api'
import { ago, date, shortCount } from '@/lib/format'

export const Route = createFileRoute('/plugins/$id')({ component: PluginPage })

function PluginPage() {
  const { id } = Route.useParams()
  const query = useQuery(q.plugins())
  return (
    <QueryView query={query}>
      {data => {
        const p = data.plugins.find(x => x.id === id)
        if (!p) return <ErrorState error={new Error(`Plugin ${id} is not installed.`)} />
        const c = p.components
        const list = (items: { name: string; description: string | null }[], prefix = '') =>
          items.length ? (
            <ul className="space-y-1.5 text-xs">
              {items.map(i => (
                <li key={i.name}>
                  <span className="font-medium">
                    {prefix}
                    {i.name}
                  </span>
                  {i.description ? (
                    <div className="line-clamp-2 text-[11px] text-muted-foreground">{i.description}</div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <Empty>None.</Empty>
          )
        return (
          <>
            <PageHeader
              title={
                <span className="flex items-center gap-2">
                  <Dot on={p.enabled} /> {p.name}{' '}
                  <span className="font-normal text-muted-foreground">v{p.version}</span>
                </span>
              }
              description={p.description}
              actions={<Tag tone={p.scope === 'project' ? 'project' : 'user'}>{p.scope}</Tag>}
            />
            <div className="grid gap-6 lg:grid-cols-2">
              <Section title="Install">
                <KeyValues
                  items={[
                    ['id', <Mono key="i">{p.id}</Mono>],
                    ['marketplace', p.marketplace],
                    ['author', p.author],
                    ['category', p.category],
                    [
                      'homepage',
                      p.homepage ? (
                        <a key="h" href={p.homepage} target="_blank" rel="noreferrer" className="underline">
                          {p.homepage}
                        </a>
                      ) : null,
                    ],
                    ['installed', date(p.installedAt)],
                    ['updated', date(p.lastUpdated)],
                    ['commit', p.gitCommitSha ? <Mono key="c">{p.gitCommitSha.slice(0, 12)}</Mono> : null],
                    [
                      'path',
                      <Mono key="p" className="break-all">
                        {p.installPath}
                      </Mono>,
                    ],
                    [
                      'manifest',
                      p.hasManifest ? '.claude-plugin/plugin.json' : 'none (defined by its marketplace entry)',
                    ],
                    ['other versions on disk', p.otherVersions.length ? p.otherVersions.join(', ') : 'none'],
                  ]}
                />
              </Section>
              <Section title="Enabled where">
                <KeyValues
                  items={[
                    ['user settings', p.userEnabled === null ? 'not listed' : p.userEnabled ? 'enabled' : 'disabled'],
                    ...p.projectEnables.map(
                      e =>
                        [<Mono key={e.path}>{e.path}</Mono>, e.enabled ? 'enabled' : 'disabled'] as [
                          React.ReactNode,
                          React.ReactNode,
                        ],
                    ),
                    [
                      'usage',
                      p.usage ? `${p.usage.usageCount} uses · last ${ago(p.usage.lastUsedAt)}` : 'never recorded',
                    ],
                    [
                      'context cost',
                      p.contextTokens
                        ? `~${shortCount(p.contextTokens.alwaysOn)} tokens always loaded, ~${shortCount(p.contextTokens.onInvoke)} when invoked (${p.contextTokens.model}, catalog of ${date(p.contextTokens.asOf)})`
                        : 'unknown',
                    ],
                  ]}
                />
              </Section>
              <Section title={`Skills (${c.skills.length})`}>{list(c.skills, `${p.name}:`)}</Section>
              <Section title={`Agents (${c.agents.length})`}>{list(c.agents)}</Section>
              <Section title={`Commands (${c.commands.length})`}>{list(c.commands, `/${p.name}:`)}</Section>
              <Section title={`Hooks (${c.hooks.length})`}>
                {c.hooks.length ? (
                  <ul className="space-y-1.5 text-xs">
                    {c.hooks.map((h, i) => (
                      <li key={i} className="flex flex-wrap items-center gap-2">
                        <Tag tone="plugin">{h.event}</Tag>
                        {h.matcher ? <Mono>{h.matcher}</Mono> : null}
                        <Mono className="break-all">{h.command}</Mono>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty>None.</Empty>
                )}
              </Section>
              <Section title={`MCP servers (${c.mcpServers.length})`}>
                {c.mcpServers.length ? (
                  <ul className="space-y-1.5 text-xs">
                    {c.mcpServers.map(m => (
                      <li key={m.name} className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{m.name}</span>
                        <Tag>{m.transport}</Tag>
                        <Mono className="break-all">{m.url ?? [m.command, ...m.args].join(' ')}</Mono>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty>None.</Empty>
                )}
              </Section>
              <Section title={`LSP servers (${c.lspServers.length})`}>
                {c.lspServers.length ? (
                  <div className="flex gap-1">
                    {c.lspServers.map(l => (
                      <Tag key={l}>{l}</Tag>
                    ))}
                  </div>
                ) : (
                  <Empty>None.</Empty>
                )}
              </Section>
            </div>
            <Link to="/plugins" className="text-xs underline">
              ← all plugins
            </Link>
          </>
        )
      }}
    </QueryView>
  )
}
