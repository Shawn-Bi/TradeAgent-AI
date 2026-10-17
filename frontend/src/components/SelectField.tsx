import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export function SelectField<T extends string | number>({
  id,
  label,
  value,
  options,
  hint,
  disabled,
  onChange,
}: {
  id: string
  label: string
  value: T
  options: { value: T; label: string }[]
  hint?: string
  disabled?: boolean
  onChange: (value: T) => void
}) {
  return (
    <div className="ta-field">
      <Label htmlFor={id}>
        {label}
      </Label>
      <Select
        value={String(value)}
        disabled={disabled}
        onValueChange={(v) => onChange(options.find((o) => String(o.value) === v)!.value)}
      >
        <SelectTrigger id={id} className="w-full font-mono" aria-describedby={hint ? `${id}-hint` : undefined}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={String(o.value)} value={String(o.value)} className="font-mono">
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {hint !== undefined && (
        <span id={`${id}-hint`} className="ta-hint">
          {hint}
        </span>
      )}
    </div>
  )
}
