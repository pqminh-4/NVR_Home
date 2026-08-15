import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { cn } from "../../lib/utils";

export function Tabs({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: { value: string; label: ReactNode }[];
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("inline-flex items-center gap-1 rounded-lg bg-muted/60 p-1 border border-border/60", className)}>
      {tabs.map((t) => (
        <button
          key={t.value}
          onClick={() => onChange(t.value)}
          className={cn(
            "relative px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
            value === t.value ? "text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {value === t.value && (
            <motion.span
              layoutId="tab-pill"
              className="absolute inset-0 rounded-md bg-card shadow-soft border border-border/50"
              transition={{ type: "spring", stiffness: 400, damping: 32 }}
            />
          )}
          <span className="relative z-10">{t.label}</span>
        </button>
      ))}
    </div>
  );
}
