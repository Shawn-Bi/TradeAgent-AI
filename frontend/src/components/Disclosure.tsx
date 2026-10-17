import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

/** Secondary detail (raw JSON, the full glossary) kept out of the way until asked for. */
export function Disclosure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Collapsible className="border-t">
      <CollapsibleTrigger className="group flex w-full cursor-pointer items-center gap-2 px-4 py-3 text-left text-code text-ink-muted outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <ChevronRight className="size-4 transition-transform group-data-[state=open]:rotate-90" aria-hidden="true" />
        {label}
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-3 px-4 pb-4">{children}</CollapsibleContent>
    </Collapsible>
  )
}
