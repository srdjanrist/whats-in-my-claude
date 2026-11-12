import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Cell, Pie, PieChart } from 'recharts'
import { BarList, Mono, PageHeader, QueryView, Section, StatCard } from '@/components/common'
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { q } from '@/lib/api'
import { bytes, dateTime } from '@/lib/format'

export const Route = createFileRoute('/storage')({ component: Storage })

const COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--muted-foreground)',
]

function Storage() {
  const query = useQuery(q.storage())
  return (
    <>
      <PageHeader
        title="Storage"
        description="Disk use of ~/.claude. Informational only: this dashboard never deletes anything. Sizes are read from file metadata, not contents."
      />
      <QueryView query={query}>
        {data => {
          const top = data.entries.slice(0, 5)
          const rest = data.entries.slice(5).reduce((n, e) => n + e.bytes, 0)
          const slices = [...top.map(e => ({ name: e.name, value: e.bytes })), { name: 'everything else', value: rest }]
          const config = Object.fromEntries(
            slices.map((s, i) => [s.name, { label: s.name, color: COLORS[i] }]),
          ) satisfies ChartConfig
          return (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <StatCard label="Total" value={bytes(data.total)} hint={data.root} />
                <StatCard
                  label="Project folders"
                  value={data.projects.length}
                  hint={bytes(data.projects.reduce((n, p) => n + p.bytes, 0))}
                />
                <StatCard
                  label="Cleanup candidates"
                  value={bytes(data.cleanup.reduce((n, c) => n + c.bytes, 0))}
                  hint={`${data.cleanup.length} groups`}
                />
                <StatCard label="Measured" value={dateTime(data.computedAt)} hint="cached for 10 minutes" />
              </div>
              <div className="grid gap-6 lg:grid-cols-2">
                <Section title="By top-level folder">
                  <div className="grid items-center gap-4 sm:grid-cols-[200px_1fr]">
                    <ChartContainer config={config} className="aspect-square h-48">
                      <PieChart>
                        <ChartTooltip
                          content={<ChartTooltipContent hideLabel formatter={(v, n) => `${n}: ${bytes(Number(v))}`} />}
                        />
                        <Pie data={slices} dataKey="value" nameKey="name" innerRadius={50} strokeWidth={2}>
                          {slices.map((s, i) => (
                            <Cell key={s.name} fill={COLORS[i]} />
                          ))}
                        </Pie>
                      </PieChart>
                    </ChartContainer>
                    <BarList
                      items={data.entries
                        .slice(0, 14)
                        .map(e => ({ key: e.name, label: e.kind === 'dir' ? `${e.name}/` : e.name, value: e.bytes }))}
                      format={bytes}
                    />
                  </div>
                </Section>
                <Section title="Largest transcripts">
                  <BarList
                    items={data.largestTranscripts.map(t => ({
                      key: t.id,
                      label: t.subagent ? (
                        <span className="text-muted-foreground">subagent of {t.id.split('/')[0]?.slice(0, 8)}</span>
                      ) : (
                        <Link to="/sessions/$id" params={{ id: t.id }} className="hover:underline">
                          {t.title ?? t.id}
                        </Link>
                      ),
                      value: t.bytes,
                    }))}
                    format={bytes}
                  />
                </Section>
              </div>
              <Section
                title="Cleanup candidates"
                description="Things that are probably safe to remove by hand. Check before deleting: some are needed to resume or rewind old sessions."
              >
                <ul className="divide-y">
                  {data.cleanup.map(c => (
                    <li key={c.label} className="grid gap-1 py-2.5 text-xs sm:grid-cols-[1fr_auto]">
                      <div>
                        <div className="font-medium">{c.label}</div>
                        <div className="text-muted-foreground">{c.detail}</div>
                        {c.paths.length <= 3 ? (
                          c.paths.map(p => (
                            <Mono key={p} className="block">
                              {p}
                            </Mono>
                          ))
                        ) : (
                          <Mono className="block">{c.paths.length} paths</Mono>
                        )}
                      </div>
                      <div className="font-semibold tabular-nums">{bytes(c.bytes)}</div>
                    </li>
                  ))}
                </ul>
              </Section>
              <Section
                title="Project folders"
                description="~/.claude/projects/* — transcripts, subagents, tool outputs and memory per project."
              >
                <BarList
                  items={data.projects.slice(0, 30).map(p => ({
                    key: p.dir,
                    label: (
                      <Link to="/projects/$id" params={{ id: p.dir }} className="font-mono text-[11px] hover:underline">
                        {p.dir}{' '}
                        <span className="text-muted-foreground">
                          · {p.transcripts} sessions{p.hasMemory ? ' · memory' : ''}
                        </span>
                      </Link>
                    ),
                    value: p.bytes,
                  }))}
                  format={bytes}
                />
              </Section>
            </>
          )
        }}
      </QueryView>
    </>
  )
}
