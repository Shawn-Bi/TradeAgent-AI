import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

// Status pills from the design system: one uppercase constant, coloured by meaning, never decoration.
const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 rounded-sm border border-current px-2 py-0.5 font-mono text-label whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        draft: "bg-marker-soft text-marker-ink",
        approved: "border-ledger bg-ledger text-on-ledger",
        compliant: "bg-compliant-soft text-compliant",
        blocked: "bg-blocked-soft text-blocked",
        neutral: "bg-card text-ink-muted",
        synthetic: "border-marker bg-marker text-ink-on-marker",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  }
)

function Badge({
  className,
  variant = "neutral",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
