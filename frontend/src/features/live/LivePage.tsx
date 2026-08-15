import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Cctv, LayoutGrid, Settings2 } from "lucide-react";
import { useCameras, useSystemInfo } from "../../hooks/data";
import { go2rtcBase } from "../../lib/api";
import { CameraTile } from "./CameraTile";
import { CameraPanel } from "./CameraPanel";
import { EmptyState } from "../../components/ui/misc";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/utils";

const LAYOUTS = [
  { n: 1, cols: 1, label: "1" },
  { n: 4, cols: 2, label: "4" },
  { n: 6, cols: 3, label: "6" },
  { n: 9, cols: 3, label: "9" },
  { n: 16, cols: 4, label: "16" },
];

export default function LivePage() {
  const { data: cams, isLoading } = useCameras();
  const { data: info } = useSystemInfo();
  const [layout, setLayout] = useState(4);
  const [selected, setSelected] = useState<number | null>(null);
  const navigate = useNavigate();

  const base = go2rtcBase(info?.go2rtc_url);
  const active = useMemo(() => (cams ?? []).filter((c) => c.enabled), [cams]);
  const layoutCfg = LAYOUTS.find((l) => l.n === layout) ?? LAYOUTS[1];
  const selectedCam = active.find((c) => c.id === selected) ?? null;

  return (
    <div className="h-full flex flex-col p-4 md:p-6 gap-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <Cctv className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold tracking-tight">Trực tiếp</h1>
          <span className="text-xs text-muted-foreground">
            {active.length > 0 && `${active.length} camera`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center gap-1 rounded-lg bg-muted/60 border border-border/60 p-1">
            <LayoutGrid className="h-3.5 w-3.5 text-muted-foreground ml-1.5 mr-0.5" />
            {LAYOUTS.filter((l) => l.n <= Math.max(4, active.length)).map((l) => (
              <button
                key={l.n}
                onClick={() => setLayout(l.n)}
                className={cn(
                  "h-7 min-w-7 px-1.5 rounded-md text-xs font-medium transition-colors",
                  layout === l.n ? "bg-card shadow-soft border border-border/50" : "text-muted-foreground hover:text-foreground",
                )}
                title={`${l.n} ô`}
              >
                {l.label}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={() => navigate("/settings")}>
            <Settings2 className="h-4 w-4" />
            <span className="hidden sm:inline">Quản lý</span>
          </Button>
        </div>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${layoutCfg.cols}, 1fr)` }}>
          {Array.from({ length: Math.min(layout, 4) }).map((_, i) => (
            <div key={i} className="skeleton w-full" style={{ aspectRatio: "16 / 9" }} />
          ))}
        </div>
      ) : active.length === 0 ? (
        <div className="card-surface flex-1 flex items-center justify-center">
          <EmptyState
            icon={<Cctv className="h-10 w-10" />}
            title="Chưa có camera nào"
            description="Thêm camera IP (RTSP) trong Cài đặt để bắt đầu xem trực tiếp. Có thể thử nhanh bằng camera demo."
            action={<Button onClick={() => navigate("/settings")}>Thêm camera</Button>}
          />
        </div>
      ) : (
        <div
          className="grid gap-3 content-start grow"
          style={{
            gridTemplateColumns: `repeat(${layoutCfg.cols}, minmax(0, 1fr))`,
            overflow: "auto",
          }}
        >
          {active.slice(0, layout).map((cam) => (
            <CameraTile
              key={cam.id}
              cam={cam}
              streamBase={base}
              selected={selected === cam.id}
              onSelect={(c) => setSelected((cur) => (cur === c.id ? null : c.id))}
            />
          ))}
        </div>
      )}

      <CameraPanel cam={selectedCam} onClose={() => setSelected(null)} />
    </div>
  );
}
