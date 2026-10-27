import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

interface BlogSelectProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  emptyLabel: string;
  disabled?: boolean;
}

export function BlogSelect({ label, value, onChange, options, emptyLabel, disabled }: BlogSelectProps) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-sm text-zinc-400">{label}</span>
      <Select
        value={value || "__empty__"}
        onValueChange={(next) => onChange(next === "__empty__" ? "" : next)}
        disabled={disabled}
      >
        <SelectTrigger aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__empty__">{emptyLabel}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
