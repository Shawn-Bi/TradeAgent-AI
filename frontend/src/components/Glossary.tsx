import { ChevronRight } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { GLOSSARY } from '@/lib/glossary'

export function Glossary({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Card id="glossary" className="ta-glossary gap-0 py-0">
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <CollapsibleTrigger className="group flex w-full cursor-pointer items-center gap-2 px-4 py-3 text-left text-code text-ink-muted outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ChevronRight className="size-4 transition-transform group-data-[state=open]:rotate-90" aria-hidden="true" />
          What do these labels and units mean?
        </CollapsibleTrigger>
        <CollapsibleContent className="px-4 pb-4">
          <dl>
            {Object.entries(GLOSSARY).map(([term, text]) => (
              <div key={term} className="contents">
                <dt>{term}</dt>
                <dd>{text}</dd>
              </div>
            ))}
          </dl>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}
