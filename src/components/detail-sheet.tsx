import type { ReactNode } from 'react'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'

/** A right-hand drawer for a file's details; open state is owned by the page (usually a search param). */
export function DetailSheet({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
}) {
  return (
    <Sheet open={open} onOpenChange={o => (o ? undefined : onClose())}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-2xl lg:max-w-3xl">
        <SheetHeader className="border-b">
          <SheetTitle className="pr-8 break-words">{title}</SheetTitle>
          {description ? <SheetDescription className="break-all">{description}</SheetDescription> : null}
        </SheetHeader>
        <div className="flex-1 space-y-4 overflow-y-auto p-4">{children}</div>
      </SheetContent>
    </Sheet>
  )
}
