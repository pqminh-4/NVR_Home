import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, CalendarDays, History } from "lucide-react";
import { api } from "../../lib/api";
import type { NvrEvent, Segment } from "../../lib/types";
import { EVENT_META } from "../../lib/types";
import { useCameras } from "../../hooks/data";
import { HeatStrip } from "./HeatStrip";
import { PlaybackPlayer } from "./PlaybackPlayer";
import { Select } from "../../components/ui/input";
import { Skeleton } from "../../components/ui/misc";
import { cn } from "../../lib/utils";

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function TimelinePage() {
  const { data: cams } = useCameras();
  const [params, setParams] = useSearchParams();
  const camIdParam = params.get("camera");

  const camId = camIdParam ? Number(camIdParam) : cams?.[0]?.id ?? null;
  const [date, setDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [time, setTime] = useState<number | null>(null);

  useEffect(() => {
    if (!camIdParam && cams?.[0]) setParams({ camera: String(cams[0].id) }, { replace: true });
  }, [camIdParam, cams, setParams]);

  const cam = cams?.find((c) => c.id === camId) ?? null;

  const segQuery = useQuery<{ segments: Segment[]; total_seconds: number }>({
    queryKey: ["recordings", camId, date],
    queryFn: () => api.get(`/recordings/${camId}/${date}`),
    enabled: camId !== null,
    refetchInterval: 30000,
  });

  const dayEvents = useQuery<{ items: NvrEvent[] }>({
    queryKey: ["events", "day", camId, date],
    queryFn: () => {
      const from = new Date(date + "T00:00:00").toISOString();
      const to = new Date(addDays(date, 1) + "T00:00:00").toISOString();
      return api.get(`/events?camera_id=${camId}&date_from=${from}&date_to=${to}&limit=200`);
    },
    enabled: camId !== null,
    refetchInterval: 30000,
  });

  const segments = useMemo(
    () => [...(segQuery.data?.segments ?? [])].sort((a, b) => a.start - b.start),
    [segQuery.data],
  );
  const events = dayEvents.data?.items ?? [];

  const seek = (t: number) => setTime(t);

  const isToday = date === (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Thanh công cụ */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <History className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold tracking-tight">Phát lại</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select
            value={camId ?? ""}
            onChange={(e) => { setParams({ camera: e.target.value }); setTime(null); }}
            className="w-44"
          >
            {(cams ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
          <div className="flex items-center gap-1">
            <button className="pg-btn" onClick={() => setDate(addDays(date, -1))} title="Ngày trước">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="relative">
              <CalendarDays className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <input
                type="date"
                value={date}
                max={date}
                onChange={(e) => e.target.value && setDate(e.target.value)}
                className="input-base pl-8 w-40 text-xs"
              />
            </div>
            <button className="pg-btn" onClick={() => setDate(addDays(date, 1))} disabled={isToday} title="Ngày sau">
              <ChevronRight className="h-4 w-4" />
            </button>
            <button className="pg-btn text-[11px] px-2.5" onClick={() => { setDate(addDays(date, 0)); setTime(null); }}>
              Hôm nay
            </button>
          </div>
        </div>
      </div>

      {camId === null ? (
        <div className="card-surface p-8 text-center text-sm text-muted-foreground">
          Chưa có camera — thêm trong Cài đặt.
        </div>
      ) : (
        <div className="grid lg:grid-cols-[1fr_280px] gap-4 items-start">
          <div className="space-y-4 min-w-0">
            {segQuery.isLoading ? (
              <Skeleton className="w-full" style={{ aspectRatio: "16/9" }} />
            ) : (
              <PlaybackPlayer
                cameraId={camId}
                date={date}
                segments={segments}
                time={time}
                onTimeChange={setTime}
              />
            )}

            {/* Heat strip + chú giải */}
            <div className="card-surface p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground">
                  {cam?.name} — {date.split("-").reverse().join("/")}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {segQuery.data ? `${Math.round(segQuery.data.total_seconds / 60)} phút ghi hình` : ""}
                </span>
              </div>
              <HeatStrip segments={segments} events={events} currentTime={time} onSeek={seek} />
              <div className="flex items-center gap-3 flex-wrap mt-3">
                {Object.entries(EVENT_META).map(([k, m]) => (
                  <span key={k} className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <span className="h-2 w-2 rounded-[2px]" style={{ background: m.color }} />
                    {m.label}
                  </span>
                ))}
                <span className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <span className="h-2 w-4 rounded-[2px] bg-[#3d5a99]" />
                  Ghi hình
                </span>
              </div>
            </div>
          </div>

          {/* Sự kiện trong ngày */}
          <div className="card-surface overflow-hidden">
            <div className="px-4 py-3 border-b border-border/60 text-xs font-semibold">
              Sự kiện trong ngày ({events.length})
            </div>
            <div className="max-h-[420px] overflow-y-auto p-2 space-y-1.5">
              {events.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-6">Không có sự kiện</p>
              )}
              {events.map((e) => {
                const t = new Date(e.ts_start);
                const sec = t.getHours() * 3600 + t.getMinutes() * 60 + t.getSeconds();
                const meta = EVENT_META[e.type] ?? EVENT_META.motion;
                return (
                  <button
                    key={e.id}
                    onClick={() => seek(sec)}
                    className={cn(
                      "w-full flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors",
                      time !== null && Math.abs(time - sec) < 12
                        ? "bg-primary/12"
                        : "hover:bg-muted/60",
                    )}
                  >
                    <span className="h-8 w-1.5 rounded-full shrink-0" style={{ background: meta.color }} />
                    <div className="min-w-0">
                      <div className="text-xs font-medium truncate">
                        {meta.label}{e.label ? ` · ${e.label}` : ""}
                      </div>
                      <div className="text-[10px] text-muted-foreground font-mono">
                        {t.toLocaleTimeString("vi-VN")}
                      </div>
                    </div>
                    {e.has_snapshot && (
                      <img
                        src={`/api/events/${e.id}/snapshot`}
                        alt=""
                        className="ml-auto h-9 w-14 rounded object-cover border border-border/60"
                        loading="lazy"
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <style>{`
        .pg-btn {
          display:inline-flex;align-items:center;justify-content:center;height:2.25rem;min-width:2.25rem;
          border-radius:0.5rem;border:1px solid hsl(var(--border));transition:all .15s;padding:0 .5rem;
        }
        .pg-btn:hover { background: hsl(var(--muted)); }
        .pg-btn:disabled { opacity:.35; pointer-events:none; }
      `}</style>
    </div>
  );
}
