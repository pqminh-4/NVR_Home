import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, XCircle, Loader2, Camera as CameraIcon } from "lucide-react";
import { api } from "../../lib/api";
import type { Camera } from "../../lib/types";
import { Dialog } from "../../components/ui/dialog";
import { Button } from "../../components/ui/button";
import { Input, Label, Select, Textarea } from "../../components/ui/input";
import { Switch } from "../../components/ui/switch";
import { useToast } from "../../components/ui/toast";
import { ZoneEditor } from "./ZoneEditor";
import { cn } from "../../lib/utils";

const CLASS_OPTIONS = [
  { key: "person", label: "Người" },
  { key: "car", label: "Ô tô / xe máy" },
  { key: "cat", label: "Mèo" },
  { key: "dog", label: "Chó" },
  { key: "motion", label: "Chuyển động (không AI)" },
];

interface TestState {
  busy: boolean;
  ok?: boolean;
  detail?: string;
}

export function CameraForm({
  open,
  onClose,
  camera,
}: {
  open: boolean;
  onClose: () => void;
  camera: Camera | null; // null = thêm mới
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState({
    name: "", url_main: "", url_sub: "",
    enabled: true, record_mode: "continuous",
    detect_enabled: true, detect_fps: 2, detect_classes: "person,car,cat,dog",
    detect_threshold: 0.55, zones: [] as number[][],
    ptz_enabled: false, onvif_url: "", onvif_user: "", onvif_pass: "",
  });
  const [testMain, setTestMain] = useState<TestState>({ busy: false });
  const [testSub, setTestSub] = useState<TestState>({ busy: false });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (camera) {
      setForm({
        name: camera.name, url_main: camera.url_main, url_sub: camera.url_sub,
        enabled: camera.enabled, record_mode: camera.record_mode,
        detect_enabled: camera.detect_enabled, detect_fps: camera.detect_fps,
        detect_classes: camera.detect_classes, detect_threshold: camera.detect_threshold,
        zones: camera.zones ?? [], ptz_enabled: camera.ptz_enabled,
        onvif_url: camera.onvif_url, onvif_user: camera.onvif_user, onvif_pass: "",
      });
    } else {
      setForm({
        name: "", url_main: "", url_sub: "",
        enabled: true, record_mode: "continuous",
        detect_enabled: true, detect_fps: 2, detect_classes: "person,car,cat,dog",
        detect_threshold: 0.55, zones: [],
        ptz_enabled: false, onvif_url: "", onvif_user: "", onvif_pass: "",
      });
    }
    setTestMain({ busy: false });
    setTestSub({ busy: false });
  }, [open, camera]);

  const test = async (url: string, which: "main" | "sub") => {
    if (!url.trim()) return;
    const set = which === "main" ? setTestMain : setTestSub;
    set({ busy: true });
    try {
      const r = await api.post<any>("/cameras/test", { url: url.trim() });
      if (r.ok) {
        const v = r.video ?? {};
        set({ busy: false, ok: true, detail: `${v.width}x${v.height} @${v.fps}fps ${v.codec ?? ""}${r.audio ? " 🔊" : ""}` });
      } else {
        set({ busy: false, ok: false, detail: r.error ?? "Không kết nối được" });
      }
    } catch (err) {
      set({ busy: false, ok: false, detail: err instanceof Error ? err.message : "Lỗi" });
    }
  };

  const toggleClass = (key: string) => {
    const cur = new Set(form.detect_classes.split(",").filter(Boolean));
    if (cur.has(key)) cur.delete(key); else cur.add(key);
    setForm((f) => ({ ...f, detect_classes: [...cur].join(",") }));
  };

  const save = async () => {
    if (!form.name.trim() || !form.url_main.trim()) {
      toast("error", "Cần nhập tên và URL stream chính");
      return;
    }
    setBusy(true);
    try {
      const body = { ...form, detect_classes: form.detect_classes || "person" };
      if (camera) await api.patch(`/cameras/${camera.id}`, body);
      else await api.post("/cameras", body);
      toast("success", camera ? "Đã cập nhật camera" : "Đã thêm camera");
      qc.invalidateQueries({ queryKey: ["cameras"] });
      qc.invalidateQueries({ queryKey: ["system"] });
      onClose();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Lỗi lưu camera");
    } finally {
      setBusy(false);
    }
  };

  const snapshotUrl = camera ? `/api/cameras/${camera.id}/snapshot` : null;

  const TestBadge = ({ state }: { state: TestState }) =>
    state.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
    : state.ok === true ? <span className="text-success text-[11px] inline-flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" />{state.detail}</span>
    : state.ok === false ? <span className="text-destructive text-[11px] inline-flex items-center gap-1"><XCircle className="h-3.5 w-3.5" />{state.detail}</span>
    : null;

  return (
    <Dialog open={open} onClose={onClose} title={camera ? `Sửa: ${camera.name}` : "Thêm camera"} wide>
      <div className="space-y-5">
        {/* Cơ bản */}
        <section className="space-y-3">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Thông tin cơ bản</h4>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <Label>Tên camera *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="VD: Sân trước"
                autoFocus={!camera}
              />
            </div>
            <div>
              <Label>Chế độ ghi hình</Label>
              <Select
                value={form.record_mode}
                onChange={(e) => setForm((f) => ({ ...f, record_mode: e.target.value }))}
              >
                <option value="continuous">Ghi liên tục 24/7</option>
                <option value="motion">Chỉ ghi khi có sự kiện</option>
                <option value="off">Không ghi</option>
              </Select>
            </div>
          </div>
          <div>
            <Label>URL stream chính (RTSP) *</Label>
            <div className="flex gap-2">
              <Input
                value={form.url_main}
                onChange={(e) => setForm((f) => ({ ...f, url_main: e.target.value }))}
                placeholder="rtsp://user:pass@192.168.1.10:554/..."
                className="font-mono text-xs"
              />
              <Button variant="outline" size="sm" className="shrink-0" onClick={() => test(form.url_main, "main")}>
                Test
              </Button>
            </div>
            <div className="mt-1 min-h-4"><TestBadge state={testMain} /></div>
          </div>
          <div>
            <Label>URL stream phụ (cho AI — khuyến nghị)</Label>
            <div className="flex gap-2">
              <Input
                value={form.url_sub}
                onChange={(e) => setForm((f) => ({ ...f, url_sub: e.target.value }))}
                placeholder="rtsp://user:pass@192.168.1.10:554/... (thường 640x360)"
                className="font-mono text-xs"
              />
              <Button variant="outline" size="sm" className="shrink-0" onClick={() => test(form.url_sub, "sub")}>
                Test
              </Button>
            </div>
            <div className="mt-1 min-h-4"><TestBadge state={testSub} /></div>
            <p className="text-[11px] text-muted-foreground/70 mt-1">
              Thêm "demo" nếu muốn tạo camera thử nghiệm không cần thiết bị thật.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Switch checked={form.enabled} onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: v }))} />
            <span className="text-sm">Bật camera</span>
          </div>
        </section>

        {/* AI */}
        <section className="space-y-3 border-t border-border/60 pt-4">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Phát hiện AI</h4>
          <div className="flex items-center gap-3">
            <Switch checked={form.detect_enabled} onCheckedChange={(v) => setForm((f) => ({ ...f, detect_enabled: v }))} />
            <span className="text-sm">Bật phát hiện trên camera này</span>
          </div>
          {form.detect_enabled && (
            <>
              <div className="flex flex-wrap gap-1.5">
                {CLASS_OPTIONS.map((c) => {
                  const active = form.detect_classes.includes(c.key);
                  return (
                    <button
                      key={c.key}
                      onClick={() => toggleClass(c.key)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs transition-colors",
                        active
                          ? "border-primary/50 bg-primary/15 text-primary"
                          : "border-border text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {c.label}
                    </button>
                  );
                })}
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <Label>Tần suất quét (fps)</Label>
                  <Select
                    value={String(form.detect_fps)}
                    onChange={(e) => setForm((f) => ({ ...f, detect_fps: Number(e.target.value) }))}
                  >
                    {[1, 2, 3, 5].map((v) => (
                      <option key={v} value={v}>
                        {v} fps{v <= 2 ? " (nhẹ CPU)" : v >= 5 ? " (tốn CPU)" : ""}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label>Ngưỡng tin cậy: {Math.round(form.detect_threshold * 100)}%</Label>
                  <input
                    type="range" min={30} max={90} step={5}
                    value={form.detect_threshold * 100}
                    onChange={(e) => setForm((f) => ({ ...f, detect_threshold: Number(e.target.value) / 100 }))}
                    className="w-full accent-[hsl(var(--primary))] mt-2.5"
                  />
                </div>
              </div>
              <div>
                <Label>Vùng quan tâm</Label>
                <ZoneEditor
                  zones={form.zones}
                  onChange={(z) => setForm((f) => ({ ...f, zones: z }))}
                  backgroundUrl={snapshotUrl}
                />
              </div>
            </>
          )}
        </section>

        {/* PTZ */}
        <section className="space-y-3 border-t border-border/60 pt-4">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">PTZ (quay/xoay)</h4>
          <div className="flex items-center gap-3">
            <Switch checked={form.ptz_enabled} onCheckedChange={(v) => setForm((f) => ({ ...f, ptz_enabled: v }))} />
            <span className="text-sm">Camera có hỗ trợ điều khiển PTZ</span>
          </div>
          {form.ptz_enabled && (
            <div className="grid sm:grid-cols-3 gap-3">
              <div className="sm:col-span-3">
                <Label>ONVIF endpoint</Label>
                <Input
                  value={form.onvif_url}
                  onChange={(e) => setForm((f) => ({ ...f, onvif_url: e.target.value }))}
                  placeholder="http://192.168.1.10:80/onvif/device_service"
                  className="font-mono text-xs"
                />
              </div>
              <div>
                <Label>Tài khoản</Label>
                <Input value={form.onvif_user} onChange={(e) => setForm((f) => ({ ...f, onvif_user: e.target.value }))} />
              </div>
              <div>
                <Label>Mật khẩu {camera && "(để trống = giữ nguyên)"}</Label>
                <Input type="password" value={form.onvif_pass} onChange={(e) => setForm((f) => ({ ...f, onvif_pass: e.target.value }))} />
              </div>
            </div>
          )}
        </section>

        <div className="flex justify-end gap-2 pt-2 border-t border-border/60">
          <Button variant="outline" onClick={onClose}>Huỷ</Button>
          <Button onClick={save} loading={busy}>
            <CameraIcon className="h-4 w-4" />
            {camera ? "Lưu thay đổi" : "Thêm camera"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
