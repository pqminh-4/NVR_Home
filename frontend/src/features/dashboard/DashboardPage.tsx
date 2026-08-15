import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Cctv, HardDrive, Cpu, BellRing, ChevronRight, Activity } from "lucide-react";
import { api } from "../../lib/api";
import type { NvrEvent } from "../../lib/types";
import { EVENT_META } from "../../lib/types";
import { useSystemInfo } from "../../hooks/data";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Skeleton } from "../../components/ui/misc";
import { fmtAgo } from "../../lib/format";
import { cn } from "../../lib/utils";

function StatCard({
  icon, label, value, sub, accent,
}: { icon: React.ReactNode; label: string; value: string; sub?: string; accent?: string }) {
  return (
    <Card className="p-4 flex items-center gap-3.5 hover:border-primary/30 transition-colors">
      <div className={cn("h-10 w-10 rounded-lg flex items-center justify-center shrink-0 bg-muted", accent)}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-2xl font-bold tracking-tight leading-none tabular-nums">{value}</div>
        <div className="text-[11px] text-muted-foreground mt-1">{label}{sub ? ` · ${sub}` : ""}</div>
      </div>
    </Card>
  );
}

export default function DashboardPage() {
  const { data: info } = useSystemInfo();
  const stats = useQuery<{ days: Record<string, Record<string, number>>; by_type: Record<string, number>; total: number }>({
    queryKey: ["events", "stats"],
    queryFn: () => api.get("/events/stats?days=7"),
    refetchInterval: 60000,
  });
  const recent = useQuery<{ items: NvrEvent[] }>({
    queryKey: ["events", "recent"],
    queryFn: () => api.get("/events?limit=8"),
    refetchInterval: 30000,
  });

  const today = new Date().toISOString().slice(0, 10);
  const todayCounts = stats.data?.days?.[today] ?? {};
  const eventsToday = Object.values(todayCounts).reduce((a, b) => a + b, 0);

  // biểu đồ cột 7 ngày
  const days = Object.keys(stats.data?.days ?? {}).sort();
  const maxCount = Math.max(1, ...days.map((d) => Object.values(stats.data!.days[d]).reduce((a, b) => a + b, 0)));

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-6xl">
      <div className="flex items-center gap-2.5">
        <Activity className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-semibold tracking-tight">Tổng quan</h1>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {!info ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)
        ) : (
          <>
            <StatCard
              icon={<Cctv className="h-5 w-5 text-primary" />}
              label="Camera online"
              value={`${info.cameras.online}/${info.cameras.total}`}
            />
            <StatCard
              icon={<BellRing className="h-5 w-5 text-warning" />}
              label="Sự kiện hôm nay"
              value={String(eventsToday)}
            />
            <StatCard
              icon={<HardDrive className="h-5 w-5 text-success" />}
              label="Ổ ghi hình"
              value={`${info.disk.used_gb} GB`}
              sub={`còn ${info.disk.free_gb} GB`}
            />
            <StatCard
              icon={<Cpu className="h-5 w-5 text-primary" />}
              label="CPU server"
              value={`${info.cpu_percent}%`}
              sub={info.memory_percent ? `RAM ${info.memory_percent}%` : undefined}
            />
          </>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-3">
        {/* Biểu đồ 7 ngày */}
        <Card>
          <CardHeader>
            <CardTitle>Sự kiện 7 ngày qua</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.isLoading ? (
              <Skeleton className="h-28" />
            ) : days.length === 0 ? (
              <p className="text-xs text-muted-foreground py-8 text-center">Chưa có dữ liệu</p>
            ) : (
              <div className="flex items-end gap-2 h-28">
                {days.map((d) => {
                  const total = Object.values(stats.data!.days[d]).reduce((a, b) => a + b, 0);
                  const h = Math.max(4, (total / maxCount) * 100);
                  return (
                    <div key={d} className="flex-1 flex flex-col items-center gap-1.5 group">
                      <span className="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity tabular-nums">
                        {total}
                      </span>
                      <div
                        className="w-full rounded-t-md bg-primary/25 group-hover:bg-primary/50 transition-colors relative overflow-hidden"
                        style={{ height: `${h}%` }}
                      >
                        {/* phân lớp theo loại */}
                        <div className="absolute inset-x-0 bottom-0 flex flex-col-reverse">
                          {Object.entries(stats.data!.days[d]).map(([t, n]) => (
                            <div
                              key={t}
                              style={{
                                height: `${(n / Math.max(1, total)) * 100}%`,
                                background: EVENT_META[t]?.color ?? "#64748b",
                                opacity: 0.55,
                              }}
                            />
                          ))}
                        </div>
                      </div>
                      <span className="text-[9px] text-muted-foreground font-mono">{d.slice(8)}/{d.slice(5, 7)}</span>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="flex items-center gap-3 flex-wrap mt-3">
              {Object.entries(stats.data?.by_type ?? {}).slice(0, 6).map(([t, n]) => (
                <span key={t} className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <span className="h-2 w-2 rounded-[2px]" style={{ background: EVENT_META[t]?.color ?? "#64748b" }} />
                  {(EVENT_META[t] ?? { label: t }).label}: {n}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Sự kiện gần đây */}
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Hoạt động gần đây</CardTitle>
            <Link to="/events" className="text-[11px] text-primary hover:underline inline-flex items-center">
              Xem tất cả <ChevronRight className="h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent className="space-y-1">
            {recent.isLoading ? (
              <Skeleton className="h-40" />
            ) : (recent.data?.items ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-10">Chưa có sự kiện nào</p>
            ) : (
              (recent.data?.items ?? []).map((e) => {
                const meta = EVENT_META[e.type] ?? EVENT_META.motion;
                return (
                  <Link
                    key={e.id}
                    to="/events"
                    className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-muted/50 transition-colors"
                  >
                    {e.has_snapshot ? (
                      <img
                        src={`/api/events/${e.id}/snapshot`}
                        alt=""
                        loading="lazy"
                        className="h-10 w-16 rounded object-cover border border-border/60"
                      />
                    ) : (
                      <div className="h-10 w-16 rounded bg-muted" />
                    )}
                    <div className="min-w-0 grow">
                      <div className="text-xs font-medium truncate">
                        <span style={{ color: meta.color }}>●</span>{" "}
                        {e.label || meta.label}
                      </div>
                      <div className="text-[10px] text-muted-foreground truncate">
                        {e.camera_name} · {fmtAgo(e.ts_start)}
                      </div>
                    </div>
                  </Link>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>

      {/* Thanh ổ đĩa */}
      {info && (
        <Card className="p-4">
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="font-medium">Dung lượng lưu trữ</span>
            <span className="text-muted-foreground">
              {info.disk.used_gb} / {info.disk.total_gb} GB ({info.disk.percent}%)
            </span>
          </div>
          <div className="h-2.5 rounded-full bg-muted overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500",
                info.disk.percent > 90 ? "bg-destructive" : info.disk.percent > 75 ? "bg-warning" : "bg-success",
              )}
              style={{ width: `${info.disk.percent}%` }}
            />
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">
            AI detect: {info.detection.backend === "yolo" ? "YOLOv8n" : "so khung hình (motion)"} ·
            Nhận diện người quen: {info.faces.available ? "bật" : "chưa cài"}
          </p>
        </Card>
      )}
    </div>
  );
}
