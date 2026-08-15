import { Suspense, lazy, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  Cctv, History, BellRing, Users, Settings2, LayoutDashboard,
  Moon, Sun, LogOut, Menu, X, Camera,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { auth } from "../../lib/api";
import { useCameras, useSystemInfo } from "../../hooks/data";
import { Spinner } from "../ui/misc";

const navItems = [
  { to: "/dashboard", label: "Tổng quan", icon: LayoutDashboard },
  { to: "/live", label: "Trực tiếp", icon: Cctv },
  { to: "/timeline", label: "Phát lại", icon: History },
  { to: "/events", label: "Sự kiện", icon: BellRing },
  { to: "/faces", label: "Người quen", icon: Users },
  { to: "/settings", label: "Cài đặt", icon: Settings2 },
];

function ThemeToggle() {
  const [dark, setDark] = useState(() => localStorage.getItem("nvr_theme") !== "light");
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("nvr_theme", dark ? "dark" : "light");
  }, [dark]);
  return (
    <button
      onClick={() => setDark((d) => !d)}
      className="p-2 rounded-md hover:bg-muted/70 transition-colors text-muted-foreground hover:text-foreground"
      title={dark ? "Chuyển sáng" : "Chuyển tối"}
    >
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

function StatusPill() {
  const { data: info } = useSystemInfo();
  const { data: cams } = useCameras();
  if (!info) return null;
  const online = cams?.filter((c) => c.enabled && c.status === "online").length ?? 0;
  const total = cams?.filter((c) => c.enabled).length ?? 0;
  return (
    <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground glass rounded-full px-3 py-1.5">
      <span className={cn("h-2 w-2 rounded-full", online > 0 ? "bg-success animate-pulse" : "bg-destructive")} />
      {online}/{total} online
      <span className="text-border">|</span>
      <span>🖥 {info.cpu_percent}%</span>
      <span className="text-border">|</span>
      <span>💾 {info.disk.percent}%</span>
    </div>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2.5 px-4 h-16 shrink-0">
        <div className="h-9 w-9 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center">
          <Camera className="h-5 w-5 text-primary" />
        </div>
        <div>
          <div className="font-bold tracking-tight leading-none">NVR<span className="text-primary">_Home</span></div>
          <div className="text-[10px] text-muted-foreground mt-0.5">Camera gia đình</div>
        </div>
      </div>
      <nav className="flex-1 px-2.5 py-3 space-y-1 overflow-y-auto">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                isActive
                  ? "bg-primary/12 text-primary shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.25)]"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
              )
            }
          >
            <item.icon className="h-[18px] w-[18px]" />
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="p-3 border-t border-border/60">
        <button
          onClick={() => { auth.clear(); window.location.href = "/login"; }}
          className="flex items-center gap-3 w-full rounded-lg px-3 py-2 text-sm text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
        >
          <LogOut className="h-4 w-4" />
          Đăng xuất
        </button>
      </div>
    </div>
  );
}

export default function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  useEffect(() => setMobileOpen(false), [location.pathname]);

  return (
    <div className="h-full flex bg-background">
      {/* Sidebar desktop */}
      <aside className="hidden md:flex w-56 shrink-0 flex-col border-r border-border/60 bg-card/50 backdrop-blur">
        <SidebarContent />
      </aside>

      {/* Drawer mobile */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              className="fixed inset-0 bg-black/50 z-40 md:hidden"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
            />
            <motion.aside
              className="fixed inset-y-0 left-0 w-60 z-50 bg-card border-r border-border md:hidden"
              initial={{ x: -260 }} animate={{ x: 0 }} exit={{ x: -260 }}
              transition={{ type: "spring", stiffness: 380, damping: 34 }}
            >
              <button
                className="absolute right-3 top-4 p-1 rounded-md hover:bg-muted"
                onClick={() => setMobileOpen(false)}
              >
                <X className="h-4 w-4" />
              </button>
              <SidebarContent onNavigate={() => setMobileOpen(false)} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 h-full">
        <header className="h-16 shrink-0 flex items-center gap-3 px-4 md:px-6 border-b border-border/60 glass z-30">
          <button className="md:hidden p-2 -ml-2 rounded-md hover:bg-muted/70" onClick={() => setMobileOpen(true)}>
            <Menu className="h-5 w-5" />
          </button>
          <StatusPill />
          <div className="grow" />
          <ThemeToggle />
        </header>

        <main className="flex-1 overflow-y-auto md:pb-0 pb-16 md:overflow-hidden">
          <Suspense fallback={<div className="flex justify-center py-24"><Spinner /></div>}>
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              className="h-full md:overflow-y-auto"
            >
              <Outlet />
            </motion.div>
          </Suspense>
        </main>

        {/* Bottom nav mobile */}
        <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 glass border-t border-border/70 flex items-center justify-around px-1 py-1.5 pb-[max(0.4rem,env(safe-area-inset-bottom))]">
          {navItems.slice(0, 5).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg text-[10px] font-medium transition-colors",
                  isActive ? "text-primary" : "text-muted-foreground",
                )
              }
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
