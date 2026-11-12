// A sortable, searchable table on TanStack Table v9. Searching is a plain
// substring match over `searchText(row)` (done before the table sees the
// rows); sorting is TanStack's sorted row model.
import {
  type ColumnDef,
  createColumnHelper,
  createSortedRowModel,
  type RowData,
  rowSortingFeature,
  type SortingState,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_datetime,
  sortFn_text,
  tableFeatures,
  useTable,
} from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ChevronsUpDown, Search } from 'lucide-react'
import { type ReactNode, useDeferredValue, useMemo, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { Empty } from './common'

export const tableFeat = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, basic: sortFn_basic, text: sortFn_text, datetime: sortFn_datetime },
})
export type Feat = typeof tableFeat

// biome-ignore lint/suspicious/noExplicitAny: column value types vary per column
export type Columns<T extends RowData> = ColumnDef<Feat, T, any>[]

export const columnHelper = <T extends RowData>() => createColumnHelper<Feat, T>()

const PAGE = 200

export function DataTable<T extends RowData>({
  data,
  columns,
  searchText,
  searchPlaceholder = 'Filter…',
  initialSort = [],
  onRowClick,
  toolbar,
  empty = 'Nothing here.',
  dense,
}: {
  data: T[]
  columns: Columns<T>
  searchText?: (row: T) => string
  searchPlaceholder?: string
  initialSort?: SortingState
  onRowClick?: (row: T) => void
  toolbar?: ReactNode
  empty?: ReactNode
  dense?: boolean
}) {
  const [sorting, setSorting] = useState<SortingState>(initialSort)
  const [filter, setFilter] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const deferred = useDeferredValue(filter.trim().toLowerCase())
  const rows = useMemo(
    () => (deferred && searchText ? data.filter(r => searchText(r).toLowerCase().includes(deferred)) : data),
    [data, deferred, searchText],
  )
  const table = useTable({
    features: tableFeat,
    columns,
    data: rows,
    state: { sorting },
    onSortingChange: setSorting,
  })
  const all = table.getRowModel().rows
  const shown = all.slice(0, limit)

  return (
    <div className="space-y-3">
      {(searchText || toolbar) && (
        <div className="flex flex-wrap items-center gap-2">
          {searchText ? (
            <div className="relative w-full max-w-xs">
              <Search className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={filter}
                onChange={e => setFilter(e.target.value)}
                placeholder={searchPlaceholder}
                className="pl-7"
              />
            </div>
          ) : null}
          {toolbar}
          <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
            {rows.length === data.length ? data.length.toLocaleString() : `${rows.length} of ${data.length}`} rows
          </span>
        </div>
      )}
      {all.length === 0 ? (
        <Empty>{empty}</Empty>
      ) : (
        <div className="border">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map(group => (
                <TableRow key={group.id} className="hover:bg-transparent">
                  {group.headers.map(header => {
                    const sorted = header.column.getIsSorted()
                    const canSort = header.column.getCanSort()
                    return (
                      <TableHead key={header.id} className="whitespace-nowrap">
                        {header.isPlaceholder ? null : canSort ? (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 hover:text-foreground"
                            onClick={header.column.getToggleSortingHandler()}
                          >
                            <table.FlexRender header={header} />
                            {sorted === 'asc' ? (
                              <ArrowUp className="size-3" />
                            ) : sorted === 'desc' ? (
                              <ArrowDown className="size-3" />
                            ) : (
                              <ChevronsUpDown className="size-3 opacity-40" />
                            )}
                          </button>
                        ) : (
                          <table.FlexRender header={header} />
                        )}
                      </TableHead>
                    )
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {shown.map(row => (
                <TableRow
                  key={row.id}
                  className={cn(onRowClick && 'cursor-pointer')}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                >
                  {row.getAllCells().map(cell => (
                    <TableCell key={cell.id} className={cn('align-top', dense ? 'py-1' : 'py-2')}>
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {all.length > shown.length ? (
            <button
              type="button"
              className="w-full border-t p-2 text-xs text-muted-foreground hover:bg-muted/50"
              onClick={() => setLimit(l => l + PAGE)}
            >
              Show {Math.min(PAGE, all.length - shown.length)} more of {all.length - shown.length}
            </button>
          ) : null}
        </div>
      )}
    </div>
  )
}
