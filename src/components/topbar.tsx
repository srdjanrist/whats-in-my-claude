import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Database, Laptop, Moon, Search, Sun } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { q } from '@/lib/api'
import { bytes } from '@/lib/format'
import { type Theme, useTheme } from '@/lib/theme'

function IndexStatus() {
  const queryClient = useQueryClient()
  const { data } = useQuery({
    ...q.indexStatus(),
    refetchInterval: query => (query.state.data?.state === 'running' ? 1500 : 30_000),
  })
  const wasRunning = useRef(false)
  useEffect(() => {
    if (data?.state === 'running') wasRunning.current = true
    if (data?.state === 'done' && wasRunning.current) {
      wasRunning.current = false
      // Totals changed: refresh the views that show indexed stats.
      void queryClient.invalidateQueries({
        predicate: query => ['overview', 'sessions', 'projects', 'project'].includes(query.queryKey[0] as string),
      })
    }
  }, [data?.state, queryClient])
  if (!data) return null
  const running = data.state === 'running'
  const pct = data.bytes ? Math.round((data.bytesDone / data.bytes) * 100) : 100
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div className="hidden items-center gap-1.5 text-[11px] text-muted-foreground sm:flex">
            <Database className={running ? 'size-3.5 animate-pulse text-chart-1' : 'size-3.5'} />
            {running ? `indexing ${pct}%` : `${data.files} transcripts indexed`}
          </div>
        }
      />
      <TooltipContent>
        {data.filesDone}/{data.files} files · {bytes(data.bytesDone)} of {bytes(data.bytes)} read
        {data.current ? ` · ${data.current}` : ''}
      </TooltipContent>
    </Tooltip>
  )
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const next: Record<Theme, Theme> = { light: 'dark', dark: 'system', system: 'light' }
  const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Laptop
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(next[theme])}
      aria-label={`Theme: ${theme}`}
      title={`Theme: ${theme}`}
    >
      <Icon />
    </Button>
  )
}

function SearchDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [text, setText] = useState('')
  const navigate = useNavigate()
  const { data, isFetching } = useQuery(q.search(text))
  const groups = new Map<string, NonNullable<typeof data>['hits']>()
  for (const hit of data?.hits ?? []) groups.set(hit.group, [...(groups.get(hit.group) ?? []), hit])
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search your setup">
      <Command shouldFilter={false}>
        <CommandInput
          placeholder="Search projects, sessions, memories, skills, plugins…"
          value={text}
          onValueChange={setText}
        />
        <CommandList>
          <CommandEmpty>
            {text.trim().length < 2 ? 'Type at least two characters.' : isFetching ? 'Searching…' : 'No matches.'}
          </CommandEmpty>
          {[...groups.entries()].map(([group, hits]) => (
            <CommandGroup key={group} heading={group}>
              {hits.map((hit, i) => (
                <CommandItem
                  key={`${group}-${i}`}
                  value={`${group}-${i}-${hit.title}`}
                  onSelect={() => {
                    onOpenChange(false)
                    void navigate({ to: hit.to, search: hit.search ?? {} })
                  }}
                >
                  <div className="min-w-0">
                    <div className="truncate">{hit.title}</div>
                    {hit.subtitle ? (
                      <div className="truncate text-[11px] text-muted-foreground">{hit.subtitle}</div>
                    ) : null}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}

export function Topbar() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(o => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <header className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-2 border-b bg-background/90 px-3 backdrop-blur">
      <SidebarTrigger />
      <Button
        variant="outline"
        size="sm"
        className="w-full max-w-sm justify-start text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        <Search />
        <span className="flex-1 text-left">Search…</span>
        <kbd className="hidden text-[10px] sm:inline">⌘K</kbd>
      </Button>
      <div className="ml-auto flex items-center gap-2">
        <IndexStatus />
        <ThemeToggle />
      </div>
      <SearchDialog open={open} onOpenChange={setOpen} />
    </header>
  )
}
