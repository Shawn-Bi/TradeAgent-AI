import type { ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { explain } from '@/lib/glossary'

/** Shows a constant or unit with its plain-language meaning on hover and keyboard focus. */
export function Term({ term, children }: { term: string; children?: ReactNode }) {
  const text = explain(term)
  if (!text) return <>{children ?? term}</>
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="cursor-help underline decoration-dotted decoration-1 underline-offset-4 outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring">
          {children ?? term}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-72">{text}</TooltipContent>
    </Tooltip>
  )
}
