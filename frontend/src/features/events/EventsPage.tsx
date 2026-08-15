import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { BellRing, ChevronDown, Trash2, X, UserRound, Filter } from "lucide-react";
import { api } from "../../lib/api";
import type { NvrEvent } from "../../lib/types";
import { EVENT_META } from "../../lib/types";
import { useCameras, useEventsFilters } from "../../hooks/data";
import { useWs } from "../../lib/ws";
import { Badge } from "../../components/ui/badge";
import { Select } from "../../components/ui/input";
import { Button } from "../../components/ui/button";
import { Skeleton, EmptyState } from "../../components/ui/misc";
import { useToast } from "../../components/ui/toast";
import { fmtTime, fmtAgo } from "../../lib/format";
import { cn } from "../../lib/utils";

const PAGE = 36;

export default function EventsPage() {
  const { data: cams } = useCameras();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [camId, setCamId] = useState("all");
  const [type, setType] = useState("all");
  const [limit, setLimit] = useState(PAGE);
  const sentinel = useRef<HTMLDivElement>(null);

  const filters: Record<string, string | number> = { limit, offset: 0 };
  if (camId !== "all") filters.camera_id = camId;
  if (type !== "all") filters.types = type;

  const { data, isLoading } = useEventsFilters(filters);
  const events = data?.items ?? [];

  // realtime: event mới → refresh danh sách
  useWs("event.new", () => {
    qc.invalidateQueries({ queryKey: ["events"] });
  });

  // infinite scroll
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const ob = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && data && data.total > limit) {
          setLimit((l) => l + PAGE);
        }
      },
      { rootMargin: "300px" },
    );
    ob.observe(el);
    return () => ob.disconnect();
  }, [data, limit]);

  const del = useCallback(
    async (e: NvrEvent) => {
      try {
        await api.del(`/events/${e.id}`);
        qc.invalidateQueries({ queryKey: ["events"] });
        toast("success", "Đã xoá sự kiện");
      } catch (err) {
        toast("error", err instanceof Error ? err.message : "Lỗi xoá");
      }
    },
    [qc, toast],
  );

  const [lightbox, setLightbox] = useState<NvrEvent | null>(null);

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <BellRing className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold tracking-tight">Sự kiện</h1>
          {data && (
            <span className="text-xs text-muted-foreground">{data.total} sự kiện</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          <Select value={camId} onChange={(e) => { setCamId(e.target.value); setLimit(PAGE); }} className="w-40">
            <option value="all">Mọi camera</option>
            {(cams ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Select value={type} onChange={(e) => { setType(e.target.value); setLimit(PAGE); }} className="w-40">
            <option value="all">Mọi loại</option>
            {Object.entries(EVENT_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="w-full" style={{ aspectRatio: "4/3" }} />)}
        </div>
      ) : events.length === 0 ? (
        <div className="card-surface">
          <EmptyState
            icon={<BellRing className="h-10 w-10" />}
            title="Chưa có sự kiện nào"
            description="Khi AI phát hiện người/xe/mèo/chó hoặc chuyển động, sự kiện sẽ xuất hiện tại đây."
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          <AnimatePresence initial={false}>
            {events.map((e) => {
              const meta = EVENT_META[e.type] ?? EVENT_META.motion;
              return (
                <motion.div
                  key={e.id}
                  layout
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: 0.18 }}
                  className="group card-surface overflow-hidden cursor-pointer hover:border-primary/40 transition-colors"
                  onClick={() => setLightbox(e)}
                >
                  <div className="relative bg-black" style={{ aspectRatio: "16/10" }}>
                    {e.has_snapshot ? (
                      <img
                        src={`/api/events/${e.id}/snapshot`}
                        alt={meta.label}
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center text-muted-foreground">
                        <UserRound className="h-8 w-8 opacity-30" />
                      </div>
                    )}
                    <span
                      className="absolute top-1.5 left-1.5 h-2.5 w-2.5 rounded-full border-2 border-black/40"
                      style={{ background: meta.color }}
                    />
                    <span className="absolute bottom-1.5 right-1.5 tile-overlay-text font-mono text-[10px] text-white">
                      {fmtTime(e.ts_start)}
                    </span>
                  </div>
                  <div className="p-2.5 flex items-center gap-2">
                    <div className="min-w-0 grow">
                      <div className="text-xs font-medium truncate">
                        {e.label ? e.label : meta.label}
                      </div>
                      <div className="text-[10px] text-muted-foreground truncate">
                        {e.camera_name} · {fmtAgo(e.ts_start)}
                      </div>
                    </div>
                    {e.label && <Badge variant="default" className="shrink-0">quen</Badge>}
                    <button
                      onClick={(ev) => { ev.stopPropagation(); del(e); }}
                      className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md hover:bg-destructive/15 hover:text-destructive transition-all"
                      title="Xoá"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {data && data.total > limit && (
        <div ref={sentinel} className="flex justify-center py-3 text-muted-foreground">
          <ChevronDown className="h-4 w-4 animate-bounce" />
        </div>
      )}

      {/* Lightbox */}
      <AnimatePresence>
        {lightbox && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-10"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          >
            <div className="absolute inset-0 bg-black/85 backdrop-blur-sm" onClick={() => setLightbox(null)} />
            <motion.div
              initial={{ scale: 0.94, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.94, opacity: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 28 }}
              className="relative max-w-4xl w-full"
            >
              <img
                src={`/api/events/${lightbox.id}/snapshot`}
                alt=""
                className="w-full rounded-lg border border-border shadow-2xl object-contain max-h-[75vh] bg-black"
              />
              <div className="mt-3 flex items-center gap-2 flex-wrap glass rounded-lg px-4 py-2.5">
                <Badge variant="neutral">
                  {lightbox.camera_name}
                </Badge>
                <Badge variant={lightbox.type === "face_stranger" ? "danger" : "default"}>
                  {(EVENT_META[lightbox.type] ?? EVENT_META.motion).label}
                </Badge>
                {lightbox.label && <Badge variant="success">{lightbox.label}</Badge>}
                <span className="font-mono text-xs text-muted-foreground">{fmtTime(lightbox.ts_start)}</span>
                <span className="text-xs text-muted-foreground">độ tin cậy {(lightbox.score * 100).toFixed(0)}%</span>
                <div className="grow" />
                <Button
                  variant="outline" size="sm"
                  onClick={() => {
                    const d = new Date(lightbox.ts_start);
                    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
                    window.location.href = `/timeline?camera=${lightbox.camera_id}#date=${date}`;
                  }}
                >
                  Xem trong Timeline
                </Button>
                <Button variant="ghost" size="icon" onClick={() => setLightbox(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
