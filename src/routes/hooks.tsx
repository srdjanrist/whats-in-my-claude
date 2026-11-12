import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Bar, BarChart, CartesianGrid, XAxis } from 'recharts'
import { BarList, Dot, Empty, Mono, PageHeader, QueryView, Section, Tag } from '@/components/common'
import { columnHelper, DataTable } from '@/components/data-table'
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { type client, q, type Res } from '@/lib/api'
import { shortCount } from '@/lib/format'

export const Route = createFileRoute('/hooks')({ component: Hooks })

type Data = Res<typeof client.api.hooks.$get>
type Hook = Data['hooks'][number]

const h = columnHelper<Hook>()
const columns = [
  h.accessor('event', {
    header: 'Event',
    cell: ({ row: { original: k } }) => (
      <div className="flex items-center gap-2">
        <Dot on={k.enabled} />
        <span className="font-medium">{k.event}</span>
      </div>
    ),
  }),
  h.accessor(r => r.matcher ?? '*', { id: 'matcher', header: 'Matcher', cell: i => <Mono>{i.getValue()}</Mono> }),
  h.accessor('source', {
    header: 'Source',
    cell: ({ row: { original: k } }) => (
      <div className="space-y-0.5">
        <Tag tone={k.source}>{k.source}</Tag>
        <div className="max-w-56 truncate font-mono text-[10px] text-muted-foreground">{k.origin}</div>
      </div>
    ),
  }),
  h.accessor('command', {
    header: 'Command',
    cell: ({ row: { original: k } }) => (
      <div className="max-w-xl">
        <Mono className="line-clamp-3 break-all text-foreground">{k.command}</Mono>
        {k.statusMessage ? <div className="text-[10px] text-muted-foreground">“{k.statusMessage}”</div> : null}
      </div>
    ),
  }),
  h.accessor(r => r.timeout ?? 0, {
    id: 'timeout',
    header: 'Timeout',
    cell: ({ row: { original: k } }) => (
      <span className="whitespace-nowrap">
        {k.timeout ? `${k.timeout}s` : 'default'}
        {k.async ? ' · async' : ''}
      </span>
    ),
  }),
]

const chartConfig = { count: { label: 'Hook events', color: 'var(--chart-1)' } } satisfies ChartConfig

function Hooks() {
  const query = useQuery(q.hooks())
  return (
    <>
      <PageHeader
        title="Hooks"
        description="Commands Claude Code runs on lifecycle events, from user settings, project settings and enabled plugins."
      />
      <QueryView query={query}>
        {data => {
          const events = [...new Set(data.hooks.map(k => k.event))].sort()
          const sources = [...new Set(data.hooks.map(k => k.source))]
          const recent = data.activity.byDay.slice(-60)
          return (
            <>
              <div className="grid gap-6 lg:grid-cols-3">
                <Section
                  className="lg:col-span-2"
                  title="Event × source"
                  description="How many hooks fire on each event, by where they are defined."
                >
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-muted-foreground">
                          <th className="py-1 pr-4 font-normal">event</th>
                          {sources.map(s => (
                            <th key={s} className="px-2 py-1 font-normal">
                              {s}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {events.map(e => (
                          <tr key={e} className="border-t">
                            <td className="py-1 pr-4 font-medium">{e}</td>
                            {sources.map(s => {
                              const n = data.hooks.filter(k => k.event === e && k.source === s).length
                              return (
                                <td key={s} className="px-2 py-1 text-center tabular-nums">
                                  {n ? (
                                    <span className="inline-block min-w-6 bg-chart-1/15 px-1">{n}</span>
                                  ) : (
                                    <span className="text-muted-foreground/40">·</span>
                                  )}
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Section>
                <Section title="Hook log" description="From claude-visualizer's hooks.jsonl, when installed.">
                  {data.activity.available ? (
                    <div className="space-y-3">
                      <div className="text-xs">
                        <span className="text-lg font-semibold">{shortCount(data.activity.total)}</span> events logged
                      </div>
                      <BarList
                        items={Object.entries(data.activity.byEvent)
                          .sort((a, b) => b[1] - a[1])
                          .slice(0, 8)
                          .map(([event, n]) => ({ key: event, label: event, value: n }))}
                        format={shortCount}
                      />
                    </div>
                  ) : (
                    <Empty>No hook log found.</Empty>
                  )}
                </Section>
              </div>
              {recent.length ? (
                <Section title="Hook events per day" description="Last 60 days in the log.">
                  <ChartContainer config={chartConfig} className="h-48 w-full">
                    <BarChart data={recent}>
                      <CartesianGrid vertical={false} />
                      <XAxis
                        dataKey="day"
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={d => String(d).slice(5)}
                        minTickGap={24}
                      />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="count" fill="var(--color-count)" />
                    </BarChart>
                  </ChartContainer>
                </Section>
              ) : null}
              <DataTable
                data={data.hooks}
                columns={columns}
                searchText={k => `${k.event} ${k.command} ${k.origin} ${k.matcher ?? ''}`}
                initialSort={[{ id: 'event', desc: false }]}
              />
            </>
          )
        }}
      </QueryView>
    </>
  )
}
