import type { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router'
import { AppSidebar } from '@/components/app-sidebar'
import { Empty } from '@/components/common'
import { Topbar } from '@/components/topbar'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
  notFoundComponent: () => (
    <Empty>
      Nothing at this address.{' '}
      <Link to="/" className="underline">
        Back to the overview
      </Link>
    </Empty>
  ),
})

function RootLayout() {
  return (
    <TooltipProvider delay={150}>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset className="min-w-0">
          <Topbar />
          <main className="mx-auto w-full max-w-[1400px] min-w-0 flex-1 space-y-6 p-4 md:p-6">
            <Outlet />
          </main>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}
