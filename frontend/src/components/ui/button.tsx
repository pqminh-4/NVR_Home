import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "../../lib/utils";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "outline" | "ghost" | "destructive" | "subtle";
  size?: "sm" | "md" | "lg" | "icon";
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "md", loading, children, disabled, ...props }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap",
        "transition-all duration-150 active:scale-[0.97] outline-none",
        "focus-visible:ring-2 focus-visible:ring-primary/50 disabled:pointer-events-none disabled:opacity-50",
        {
          default: "bg-primary text-primary-foreground shadow-glow hover:bg-primary/90",
          outline: "border border-border bg-transparent hover:bg-muted/60",
          ghost: "hover:bg-muted/60",
          destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
          subtle: "bg-muted text-foreground hover:bg-muted/70",
        }[variant],
        {
          sm: "h-8 px-3 text-xs",
          md: "h-9 px-4 text-sm",
          lg: "h-11 px-6 text-base",
          icon: "h-9 w-9",
        }[size],
        className,
      )}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  ),
);
Button.displayName = "Button";
