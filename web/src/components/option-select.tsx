import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select.tsx";

export type Option = { value: string; label: string };

/**
 * shadcn's Select composed for the common case of a flat option list, so a
 * view does not repeat five elements to offer four choices.
 */
export function OptionSelect({
  value,
  onValueChange,
  options,
  placeholder,
  className,
  size = "default",
  "aria-label": ariaLabel,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: Option[];
  placeholder?: string;
  className?: string;
  size?: "sm" | "default";
  "aria-label"?: string;
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className={className} size={size} aria-label={ariaLabel}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
