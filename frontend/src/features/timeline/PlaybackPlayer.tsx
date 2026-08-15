import { useCallback, useEffect, useRef, useState } from "react";
import {
  Play, Pause, RotateCcw, RotateCw, Download, CameraIcon, Volume2, VolumeX,
} from "lucide-react";
import type { Segment } from "../../lib/types";
import { secsToClock } from "../../lib/format";
import { api, auth } from "../../lib/api";
import { cn } from "../../lib/utils";

interface Props {
  cameraId: number;
  date: string;
  segments: Segment[];
  time: number | null;
  onTimeChange: (t: number) => void;
}

/** Phát các file MP4 ghi hình nối tiếp nhau theo timeline. */
export function PlaybackPlayer({ cameraId, date, segments, time, onTimeChange }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const curFileRef = useRef<string>("");
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(true);

  const seg = time === null ? null : segments.find((s) => time >= s.start && time < s.end);
  const idx = seg ? segments.indexOf(seg) : -1;
  const next = idx >= 0 && idx + 1 < segments.length ? segments[idx + 1] : null;

  // nạp segment tương ứng khi time thay đổi từ ngoài (seek)
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !seg) return;
    if (seg.file !== curFileRef.current) {
      curFileRef.current = seg.file;
      video.src = `/api/recordings/file?camera=${cameraId}&date=${date}&file=${encodeURIComponent(seg.file)}`;
      video.currentTime = time! - seg.start;
      video.play().catch(() => setPaused(true));
      setPaused(false);
    }
  }, [seg, time, cameraId, date]);

  // đồng bộ thanh tiến trình
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !seg) return;
    const onTime = () => {
      if (!video.seeking) onTimeChange(seg.start + video.currentTime);
    };
    video.addEventListener("timeupdate", onTime);
    return () => video.removeEventListener("timeupdate", onTime);
  }, [seg, onTimeChange]);

  const jump = useCallback(
    (delta: number) => {
      if (time === null) return;
      const t = Math.max(0, Math.min(86399, time + delta));
      const target = segments.find((s) => t >= s.start && t < s.end);
      if (!target) {
        // tìm segment kế tiếp theo hướng đi
        const sorted = [...segments].sort((a, b) => a.start - b.start);
        const cand = delta > 0 ? sorted.find((s) => s.start > t) : [...sorted].reverse().find((s) => s.end <= t);
        if (cand) {
          curFileRef.current = "";
          onTimeChange(delta > 0 ? cand.start + 0.1 : cand.end - 0.5);
        }
        return;
      }
      if (target.file !== curFileRef.current) {
        curFileRef.current = "";
        onTimeChange(t);
      } else {
        videoRef.current!.currentTime = t - target.start;
      }
    },
    [time, segments, onTimeChange],
  );

  // phím tắt
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.code === "Space") { e.preventDefault(); togglePlay(); }
      if (e.code === "ArrowLeft") jump(-10);
      if (e.code === "ArrowRight") jump(10);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
    setPaused(!v.paused);
  };

  const download = () => {
    if (!seg) return;
    const a = document.createElement("a");
    a.href = `/api/recordings/file?camera=${cameraId}&date=${date}&file=${encodeURIComponent(seg.file)}`;
    a.download = seg.file;
    a.click();
  };

  const captureFrame = () => {
    const v = videoRef.current;
    if (!v) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    c.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `nvr_${date}_${secsToClock(time ?? 0).replace(/:/g, "-")}.jpg`;
      a.click();
      URL.revokeObjectURL(a.href);
    }, "image/jpeg", 0.92);
  };

  const ended = () => {
    if (next) {
      curFileRef.current = "";
      onTimeChange(next.start + 0.1);
    }
  };

  const hasVideo = !!seg;

  return (
    <div className="space-y-2.5">
      <div className="relative bg-black rounded-lg overflow-hidden border border-border/60" style={{ aspectRatio: "16 / 9" }}>
        <video
          ref={videoRef}
          className="h-full w-full object-contain"
          playsInline
          muted={muted}
          onEnded={ended}
          onClick={togglePlay}
        />
        {!hasVideo && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
            <p className="text-sm text-muted-foreground">
              {segments.length === 0
                ? "Không có ghi hình ngày này"
                : "Chọn thời điểm trên timeline để phát"}
            </p>
          </div>
        )}
        {hasVideo && paused && (
          <button
            onClick={togglePlay}
            className="absolute inset-0 flex items-center justify-center bg-black/30 hover:bg-black/40 transition-colors"
          >
            <span className="h-16 w-16 rounded-full bg-primary/90 flex items-center justify-center shadow-glow">
              <Play className="h-7 w-7 text-white ml-1" />
            </span>
          </button>
        )}
      </div>

      {/* Điều khiển */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <button onClick={() => jump(-10)} className="ctrl-btn" title="Lùi 10s (←)">
          <RotateCcw className="h-4 w-4" />
        </button>
        <button onClick={togglePlay} className="ctrl-btn" title="Phát/Dừng (Space)">
          {paused || !hasVideo ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
        </button>
        <button onClick={() => jump(10)} className="ctrl-btn" title="Tới 10s (→)">
          <RotateCw className="h-4 w-4" />
        </button>
        <button onClick={() => setMuted((m) => !m)} className="ctrl-btn" title="Âm thanh">
          {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </button>

        <span className="font-mono text-xs text-muted-foreground tabular-nums ml-1">
          {time !== null ? secsToClock(time) : "--:--:--"}
        </span>

        <div className="grow" />
        <button onClick={captureFrame} className="ctrl-btn" title="Lưu khung hình" disabled={!hasVideo}>
          <CameraIcon className="h-4 w-4" />
        </button>
        <button onClick={download} className="ctrl-btn" title="Tải clip 10s hiện tại" disabled={!hasVideo}>
          <Download className="h-4 w-4" />
        </button>
      </div>

      <style>{`
        .ctrl-btn {
          display: inline-flex; align-items: center; justify-content: center;
          height: 2.25rem; width: 2.25rem; border-radius: 0.5rem;
          border: 1px solid hsl(var(--border)); color: hsl(var(--foreground));
          transition: all .15s;
        }
        .ctrl-btn:hover { background: hsl(var(--muted)); border-color: hsl(var(--primary) / .5); }
        .ctrl-btn:disabled { opacity: .4; pointer-events: none; }
      `}</style>
    </div>
  );
}
