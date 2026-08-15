import { useEffect, useRef, useState } from "react";
import { Trash2, SquareDashedMousePointer } from "lucide-react";
import { Button } from "../../components/ui/button";

/** Vẽ vùng quan tâm (0..1) lên canvas — kéo để thêm, chọn rồi xoá. */
export function ZoneEditor({
  zones,
  onChange,
  backgroundUrl,
}: {
  zones: number[][];
  onChange: (zones: number[][]) => void;
  backgroundUrl?: string | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const bgRef = useRef<HTMLImageElement | null>(null);
  const [bgLoaded, setBgLoaded] = useState(false);

  useEffect(() => {
    if (!backgroundUrl) return;
    const img = new Image();
    img.onload = () => { bgRef.current = img; setBgLoaded(true); draw(); };
    img.src = backgroundUrl;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backgroundUrl]);

  const W = 352, H = 198;

  const draw = () => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, W, H);
    // nền
    if (bgRef.current) {
      ctx.drawImage(bgRef.current, 0, 0, W, H);
    } else {
      ctx.fillStyle = "#101218";
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      for (let x = 0; x <= W; x += 44) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      for (let y = 0; y <= H; y += 44) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.font = "11px sans-serif";
      ctx.fillText("Chưa có ảnh nền", W / 2 - 44, H / 2);
    }

    zones.forEach((z, i) => {
      const [x1, y1, x2, y2] = z;
      const px = Math.min(x1, x2) * W, py = Math.min(y1, y2) * H;
      const pw = Math.abs(x2 - x1) * W, ph = Math.abs(y2 - y1) * H;
      ctx.fillStyle = i === selected ? "rgba(79,124,255,0.4)" : "rgba(79,124,255,0.22)";
      ctx.strokeStyle = i === selected ? "#4f7cff" : "rgba(79,124,255,0.75)";
      ctx.lineWidth = 2;
      ctx.fillRect(px, py, pw, ph);
      ctx.strokeRect(px, py, pw, ph);
      ctx.fillStyle = "#fff";
      ctx.font = "10px ui-monospace";
      ctx.fillText(String(i + 1), px + 5, py + 13);
    });

    if (drag) {
      // đang kéo: vẽ preview
      const px = Math.min(drag.x, dragCur.x) * W, py = Math.min(drag.y, dragCur.y) * H;
      const pw = Math.abs(dragCur.x - drag.x) * W, ph = Math.abs(dragCur.y - drag.y) * H;
      ctx.fillStyle = "rgba(79,124,255,0.18)";
      ctx.strokeStyle = "#4f7cff";
      ctx.setLineDash([5, 4]);
      ctx.fillRect(px, py, pw, ph);
      ctx.strokeRect(px, py, pw, ph);
      ctx.setLineDash([]);
    }
  };

  const [dragCur, setDragCur] = useState({ x: 0, y: 0 });

  useEffect(draw, [zones, selected, drag, dragCur, bgLoaded]);

  const pos = (e: React.MouseEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    };
  };

  const onMouseDown = (e: React.MouseEvent) => {
    const p = pos(e);
    // chọn vùng có sẵn?
    const hit = zones.findIndex(([x1, y1, x2, y2]) => {
      const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
      const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
      return p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
    });
    if (hit >= 0) {
      setSelected(hit === selected ? null : hit);
      return;
    }
    setSelected(null);
    setDrag(p);
    setDragCur(p);
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!drag) return;
    setDragCur(pos(e));
  };

  const onMouseUp = () => {
    if (!drag) return;
    const w = Math.abs(dragCur.x - drag.x), h = Math.abs(dragCur.y - drag.y);
    if (w > 0.04 && h > 0.04) {
      onChange([...zones, [
        Math.min(drag.x, dragCur.x), Math.min(drag.y, dragCur.y),
        Math.max(drag.x, dragCur.x), Math.max(drag.y, dragCur.y),
      ]]);
    }
    setDrag(null);
  };

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        className="rounded-lg border border-border cursor-crosshair w-full max-w-[352px]"
      />
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
          <SquareDashedMousePointer className="h-3.5 w-3.5" />
          Kéo trên ảnh để thêm vùng — chỉ phát hiện đối tượng bên trong vùng
        </span>
        {selected !== null && (
          <Button
            size="sm" variant="destructive"
            onClick={() => { onChange(zones.filter((_, i) => i !== selected)); setSelected(null); }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Xoá vùng {selected + 1}
          </Button>
        )}
        {zones.length === 0 && (
          <span className="text-[11px] text-muted-foreground/60">(trống = toàn khung hình)</span>
        )}
      </div>
    </div>
  );
}
