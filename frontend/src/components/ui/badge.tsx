import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

const styles: Record<string, string> = {
  default: "bg-primary/15 text-primary border-primary/30",
  neutral: "bg-muted text-muted-foreground border-border",
  success: "bg-success/15 text-success border-success/30",
  warning: "bg-warning/15 text-warning border-warning/30",
  danger: "bg-destructive/15 text-destructive border-destructive/30",
};

export function Badge({
  variant = "default",
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { variant?: keyof typeof styles }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4",
        styles[variant],
        className,
      )}
      {...props}
    />
  );
}
