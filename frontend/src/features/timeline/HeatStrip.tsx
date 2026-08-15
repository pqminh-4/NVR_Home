import { useEffect, useRef, useState } from "react";
import type { NvrEvent, Segment } from "../../lib/types";
import { EVENT_META } from "../../lib/types";
import { secsToClock } from "../../lib/format";

const H = 44;

/** Heat-strip 24 giờ: thanh ghi hình + vạch màu event, click để tua. */
export function HeatStrip({
  segments,
  events,
  currentTime,
  onSeek,
}: {
  segments: Segment[];
  events: NvrEvent[];
  currentTime: number | null;
  onSeek: (secOfDay: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const W = wrap.clientWidth;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, W, H);

      const style = getComputedStyle(document.documentElement);
      const muted = style.getPropertyValue("--muted").trim();
      const border = style.getPropertyValue("--border").trim();

      // rãnh nền
      ctx.fillStyle = muted;
      ctx.beginPath();
      ctx.roundRect(0, 14, W, 16, 8);
      ctx.fill();

      // đoạn ghi hình
      ctx.fillStyle = "#3d5a99";
      for (const s of segments) {
        const x = (s.start / 86400) * W;
        const w = Math.max(1.2, (s.duration / 86400) * W);
        ctx.beginPath();
        ctx.roundRect(x, 14, Math.min(w, W - x), 16, 3);
        ctx.fill();
      }

      // vạch event
      for (const e of events) {
        const t = new Date(e.ts_start);
        const sec = t.getHours() * 3600 + t.getMinutes() * 60 + t.getSeconds();
        const x = (sec / 86400) * W;
        const meta = EVENT_META[e.type] ?? EVENT_META.motion;
        ctx.fillStyle = meta.color;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.roundRect(x - 1.2, 8, 2.6, 28, 1.5);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // vạch giờ
      ctx.fillStyle = border;
      ctx.font = "9px ui-monospace, monospace";
      for (let h = 0; h <= 24; h += 3) {
        const x = (h / 24) * W;
        ctx.fillRect(h === 24 ? x - 1 : x, 0, 1, 4);
        if (h < 24) ctx.fillText(String(h).padStart(2, "0"), h === 0 ? x + 2 : x - 8, H - 2);
      }

      // con trỏ hiện tại
      if (currentTime !== null) {
        const x = (currentTime / 86400) * W;
        ctx.fillStyle = "#ef4444";
        ctx.beginPath();
        ctx.roundRect(x - 1, 2, 2, H - 8, 1);
        ctx.fill();
      }
      // hover
      if (hover !== null) {
        const x = (hover / 86400) * W;
        ctx.fillStyle = "rgba(255,255,255,0.35)";
        ctx.fillRect(x, 2, 1, H - 8);
      }
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [segments, events, currentTime, hover]);

  const posToSec = (e: React.MouseEvent) => {
    const rect = wrapRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(86399, ((e.clientX - rect.left) / rect.width) * 86400));
  };

  return (
    <div
      ref={wrapRef}
      className="relative cursor-crosshair select-none"
      onMouseMove={(e) => setHover(posToSec(e))}
      onMouseLeave={() => setHover(null)}
      onClick={(e) => onSeek(Math.floor(posToSec(e)))}
      title={hover !== null ? secsToClock(hover) : undefined}
    >
      <canvas ref={canvasRef} />
    </div>
  );
}
