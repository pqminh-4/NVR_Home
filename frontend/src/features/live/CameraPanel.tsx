import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  X, Camera as CameraIcon, ChevronUp, ChevronDown, ChevronLeft, ChevronRight,
  ZoomIn, ZoomOut, Move3d, History, Loader2,
} from "lucide-react";
import type { Camera } from "../../lib/types";
import { api } from "../../lib/api";
import { useToast } from "../../components/ui/toast";
import { Badge } from "../../components/ui/badge";
import { fmtAgo } from "../../lib/format";
import { cn } from "../../lib/utils";

const ptzBtn =
  "flex items-center justify-center rounded-md bg-muted/70 hover:bg-primary/20 hover:text-primary transition-colors h-9 w-9";

export function CameraPanel({ cam, onClose }: { cam: Camera | null; onClose: () => void }) {
  const { toast } = useToast();
  const [ptzBusy, setPtzBusy] = useState(false);
  const [snapBusy, setSnapBusy] = useState(false);

  if (!cam) return null;

  const ptz = async (action: string) => {
    setPtzBusy(true);
    try {
      await api.post(`/cameras/${cam.id}/ptz`, { action });
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Lỗi PTZ");
    } finally {
      setPtzBusy(false);
    }
  };

  const snapshot = async () => {
    setSnapBusy(true);
    try {
      const resp = await fetch(`/api/cameras/${cam.id}/snapshot`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("nvr_token")}` },
      });
      if (!resp.ok) throw new Error("Không chụp được ảnh");
      const blob = await resp.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${cam.slug}_${Date.now()}.jpg`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast("success", "Đã lưu ảnh chụp");
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Lỗi chụp ảnh");
    } finally {
      setSnapBusy(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.aside
        key={cam.id}
        initial={{ x: 340, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 340, opacity: 0 }}
        transition={{ type: "spring", stiffness: 320, damping: 32 }}
        className="fixed md:right-4 md:top-20 md:bottom-4 md:w-72 inset-x-3 bottom-20 top-auto z-40 md:inset-x-auto
                   glass rounded-xl shadow-2xl p-4 flex flex-col gap-4 md:max-h-none"
        style={{ maxHeight: "70vh" }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-semibold text-sm truncate">{cam.name}</h3>
            <p className="text-[11px] text-muted-foreground">
              {cam.last_frame_at ? `Hoạt động · ${fmtAgo(cam.last_frame_at)}` : "Chưa thấy khung hình"}
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-muted/70">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Badge variant={cam.status === "online" ? "success" : cam.status === "error" ? "danger" : "neutral"}>
            {cam.status === "online" ? "Online" : cam.status === "error" ? "Lỗi" : "Offline"}
          </Badge>
          <Badge variant="neutral">
            {cam.record_mode === "continuous" ? "Ghi 24/7" : cam.record_mode === "motion" ? "Ghi khi có sự kiện" : "Không ghi"}
          </Badge>
          {cam.detect_enabled && <Badge variant="default">AI detect</Badge>}
        </div>

        {cam.last_error && (
          <p className="text-[11px] text-destructive/90 bg-destructive/10 rounded-md px-2.5 py-2 leading-relaxed break-words">
            {cam.last_error}
          </p>
        )}

        <div className="space-y-2">
          <button
            onClick={snapshot}
            disabled={snapBusy}
            className="w-full flex items-center justify-center gap-2 h-9 rounded-md bg-muted/70 hover:bg-muted text-sm transition-colors disabled:opacity-50"
          >
            {snapBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CameraIcon className="h-4 w-4" />}
            Chụp ảnh hiện tại
          </button>
          <a
            href={`/timeline?camera=${cam.id}`}
            className="w-full flex items-center justify-center gap-2 h-9 rounded-md bg-muted/70 hover:bg-muted text-sm transition-colors"
          >
            <History className="h-4 w-4" />
            Phát lại camera này
          </a>
        </div>

        {cam.has_ptz && (
          <div className="border-t border-border/60 pt-3">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-2">
              <Move3d className="h-3.5 w-3.5" /> Điều khiển PTZ {ptzBusy && <Loader2 className="h-3 w-3 animate-spin" />}
            </div>
            <div className="grid grid-cols-3 gap-1.5 w-fit mx-auto">
              <div />
              <button className={ptzBtn} onClick={() => ptz("up")}><ChevronUp className="h-4 w-4" /></button>
              <div />
              <button className={ptzBtn} onClick={() => ptz("left")}><ChevronLeft className="h-4 w-4" /></button>
              <button className={cn(ptzBtn, "text-[10px] font-bold")} onClick={() => ptz("stop")}>STOP</button>
              <button className={ptzBtn} onClick={() => ptz("right")}><ChevronRight className="h-4 w-4" /></button>
              <button className={ptzBtn} onClick={() => ptz("zoom_in")}><ZoomIn className="h-4 w-4" /></button>
              <button className={ptzBtn} onClick={() => ptz("down")}><ChevronDown className="h-4 w-4" /></button>
              <button className={ptzBtn} onClick={() => ptz("zoom_out")}><ZoomOut className="h-4 w-4" /></button>
            </div>
          </div>
        )}
      </motion.aside>
    </AnimatePresence>
  );
}
