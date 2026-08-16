import { memo, useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, Maximize2, Volume2, VolumeX } from "lucide-react";
import type { Camera } from "../../lib/types";
import { attachStream } from "../../lib/player";
import { cn } from "../../lib/utils";

type Status = "connecting" | "playing" | "error";

export const CameraTile = memo(function CameraTile({
  cam,
  streamBase,
  onSelect,
  selected,
}: {
  cam: Camera;
  streamBase: string;
  onSelect?: (cam: Camera) => void;
  selected?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [muted, setMuted] = useState(true);
  const [clock, setClock] = useState(() => new Date());
  const isDemo = cam.url_main?.startsWith("demo");

  useEffect(() => {
    const t = window.setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !cam.enabled || isDemo) return;
    const handle = attachStream(video, streamBase, cam.slug, (s) => setStatus(s));
    return () => handle.stop();
  }, [cam.slug, cam.enabled, streamBase, isDemo]);

  useEffect(() => {
    if (isDemo && cam.enabled) setStatus("playing");
  }, [isDemo, cam.enabled]);

  const online = cam.status === "online";

  const goFullscreen = () => {
    const el = boxRef.current;
    if (el?.requestFullscreen) el.requestFullscreen();
  };

  return (
    <div
      ref={boxRef}
      onClick={() => onSelect?.(cam)}
      onDoubleClick={goFullscreen}
      className={cn(
        "group relative bg-black rounded-lg overflow-hidden border transition-all duration-200 cursor-pointer select-none",
        selected ? "border-primary/70 shadow-glow" : "border-border/60 hover:border-primary/40",
      )}
      style={{ aspectRatio: "16 / 9" }}
    >
      {isDemo ? (
        <img
          src={`/api/cameras/${cam.id}/live.mjpeg?token=${localStorage.getItem("nvr_token") ?? ""}`}
          alt={cam.name}
          className="h-full w-full object-contain"
        />
      ) : (
        <video
          ref={videoRef}
          autoPlay
          muted={muted}
          playsInline
          disablePictureInPicture
          className="h-full w-full object-contain"
        />
      )}

      {/* Trạng thái */}
      {status === "connecting" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-card/60">
          <Loader2 className="h-6 w-6 text-primary animate-spin" />
          <span className="text-[11px] text-muted-foreground">Đang kết nối…</span>
        </div>
      )}
      {status === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-card/80">
          <AlertTriangle className="h-6 w-6 text-warning" />
          <span className="text-[11px] text-muted-foreground">Mất kết nối — thử lại…</span>
        </div>
      )}
      {!cam.enabled && (
        <div className="absolute inset-0 flex items-center justify-center bg-card/90">
          <span className="text-xs text-muted-foreground">Camera đang tắt</span>
        </div>
      )}

      {/* Overlay trên */}
      <div className="absolute inset-x-0 top-0 p-2.5 flex items-start justify-between
                      bg-gradient-to-b from-black/60 to-transparent opacity-90">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className={cn(
              "h-2 w-2 rounded-full shrink-0",
              online ? "bg-success shadow-[0_0_6px_hsl(var(--success))]" : "bg-destructive",
              !online && "animate-pulse",
            )}
          />
          <span className="tile-overlay-text text-white text-xs font-medium truncate drop-shadow">
            {cam.name}
          </span>
          {cam.res_main && (
            <span className="tile-overlay-text text-white/50 text-[10px] font-mono shrink-0">
              {cam.res_main}
            </span>
          )}
        </div>
        <span className="tile-overlay-text font-mono text-[11px] text-white/90 tabular-nums">
          {clock.toLocaleTimeString("vi-VN")}
        </span>
      </div>

      {/* Hover controls */}
      <div className="absolute bottom-0 inset-x-0 p-2 flex items-center justify-end gap-1
                      bg-gradient-to-t from-black/60 to-transparent
                      opacity-0 group-hover:opacity-100 transition-opacity duration-200">
        <button
          onClick={(e) => { e.stopPropagation(); setMuted((m) => !m); }}
          className="p-1.5 rounded-md bg-black/50 text-white/90 hover:bg-black/70 transition-colors"
          title={muted ? "Bật âm thanh" : "Tắt âm thanh"}
        >
          {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); goFullscreen(); }}
          className="p-1.5 rounded-md bg-black/50 text-white/90 hover:bg-black/70 transition-colors"
          title="Toàn màn hình"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
});
