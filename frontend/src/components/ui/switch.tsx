import { cn } from "../../lib/utils";

export function Switch({
  checked,
  onCheckedChange,
  disabled,
  className,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-5.5 w-10 shrink-0 items-center rounded-full border transition-colors duration-200",
        "focus-visible:ring-2 focus-visible:ring-primary/50 outline-none disabled:opacity-50",
        checked ? "bg-primary border-primary" : "bg-muted border-border",
        className,
      )}
      style={{ height: 22 }}
    >
      <span
        className={cn(
          "block h-4 w-4 rounded-full bg-white shadow transition-transform duration-200",
          checked ? "translate-x-[21px]" : "translate-x-[3px]",
        )}
      />
    </button>
  );
}
