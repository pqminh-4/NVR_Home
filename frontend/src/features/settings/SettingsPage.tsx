import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus, Pencil, Trash2, Cctv, Save, HardDrive, BellRing, Shield,
  Eye, EyeOff, Send, Server, Loader2,
} from "lucide-react";
import { api } from "../../lib/api";
import type { Camera, NvrSettings } from "../../lib/types";
import { useCameras, useSystemInfo, useInvalidate } from "../../hooks/data";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input, Label, Select } from "../../components/ui/input";
import { Switch } from "../../components/ui/switch";
import { Tabs } from "../../components/ui/tabs";
import { Badge } from "../../components/ui/badge";
import { useToast } from "../../components/ui/toast";
import { CameraForm } from "./CameraForm";
import { cn } from "../../lib/utils";

/* ================= Cameras tab ================= */

function CamerasTab() {
  const { data: cams } = useCameras();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Camera | null>(null);

  const del = async (c: Camera) => {
    const alsoFiles = confirm(`Xoá camera "${c.name}"?\n\nOK = xoá cả file ghi hình của camera này\nHuỷ = giữ file, chỉ xoá camera\n\n(Bấm Esc để không xoá gì)`);
    if (alsoFiles === null) return;
    try {
      await api.del(`/cameras/${c.id}?delete_recordings=${alsoFiles}`);
      toast("success", "Đã xoá camera");
      qc.invalidateQueries({ queryKey: ["cameras"] });
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Lỗi xoá");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {(cams ?? []).length} camera · luồng RTSP, demo dùng để thử nghiệm
        </p>
        <Button size="sm" onClick={() => { setEditing(null); setFormOpen(true); }}>
          <Plus className="h-4 w-4" /> Thêm camera
        </Button>
      </div>
      {(cams ?? []).map((c) => (
        <Card key={c.id} className="p-3.5 flex items-center gap-3">
          <span
            className={cn(
              "h-2.5 w-2.5 rounded-full shrink-0",
              c.status === "online" ? "bg-success" : c.status === "error" ? "bg-destructive" : "bg-muted-foreground/40",
            )}
          />
          <div className="min-w-0 grow">
            <div className="text-sm font-medium truncate">{c.name}</div>
            <div className="text-[11px] text-muted-foreground truncate font-mono">
              {c.url_main === "demo" ? "nguồn demo" : c.url_main.replace(/\/\/.*@/, "//***@")}
            </div>
          </div>
          <Badge variant={c.record_mode === "off" ? "neutral" : c.record_mode === "motion" ? "warning" : "success"}>
            {c.record_mode === "continuous" ? "24/7" : c.record_mode === "motion" ? "sự kiện" : "không ghi"}
          </Badge>
          {c.detect_enabled && <Badge variant="default">AI</Badge>}
          <Button variant="ghost" size="icon" onClick={() => { setEditing(c); setFormOpen(true); }} title="Sửa">
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => del(c)} title="Xoá">
            <Trash2 className="h-4 w-4 text-destructive/80" />
          </Button>
        </Card>
      ))}
      {(cams ?? []).length === 0 && (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          <Cctv className="h-8 w-8 mx-auto mb-2 opacity-40" />
          Chưa có camera — bấm "Thêm camera" để bắt đầu
        </Card>
      )}
      <CameraForm open={formOpen} onClose={() => setFormOpen(false)} camera={editing} />
    </div>
  );
}

/* ================= Storage/AI tab ================= */

function StorageAiTab() {
  const { data: info } = useSystemInfo();
  const { data: settings } = useSettings();
  const invalidate = useInvalidate();
  const { toast } = useToast();
  const [form, setForm] = useState<Partial<NvrSettings>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (settings) setForm(settings);
  }, [settings]);

  const save = async () => {
    setBusy(true);
    try {
      await api.put("/settings", {
        values: {
          retention_days: Number(form.retention_days ?? 14),
          max_storage_gb: Number(form.max_storage_gb ?? 0),
          face_enabled: !!form.face_enabled,
          face_threshold: Number(form.face_threshold ?? 0.38),
          stranger_alert: !!form.stranger_alert,
        },
      });
      invalidate.settings();
      toast("success", "Đã lưu cài đặt lưu trữ & AI");
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Lỗi lưu");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 max-w-xl">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HardDrive className="h-4 w-4 text-primary" /> Lưu trữ ghi hình
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {info && (
            <div className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-3">
              Ổ hiện tại: <b>{info.disk.used_gb} / {info.disk.total_gb} GB</b> đã dùng (còn {info.disk.free_gb} GB)
              <div className="h-2 rounded-full bg-border mt-2 overflow-hidden">
                <div
                  className={cn("h-full", info.disk.percent > 90 ? "bg-destructive" : "bg-success")}
                  style={{ width: `${info.disk.percent}%` }}
                />
              </div>
            </div>
          )}
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <Label>Giữ ghi hình (ngày)</Label>
              <Input
                type="number" min={1} max={365}
                value={form.retention_days ?? 14}
                onChange={(e) => setForm((f) => ({ ...f, retention_days: Number(e.target.value) }))}
              />
              <p className="text-[11px] text-muted-foreground/70 mt-1">File cũ hơn sẽ tự xoá (quét mỗi 15 phút).</p>
            </div>
            <div>
              <Label>Giới hạn dung lượng (GB)</Label>
              <Input
                type="number" min={0}
                value={form.max_storage_gb ?? 0}
                onChange={(e) => setForm((f) => ({ ...f, max_storage_gb: Number(e.target.value) }))}
              />
              <p className="text-[11px] text-muted-foreground/70 mt-1">0 = không giới hạn. Ưu tiên xoá file cũ nhất.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-primary" /> Nhận diện người quen
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm">Bật nhận diện khuôn mặt</div>
              <div className="text-[11px] text-muted-foreground">
                {info?.faces.available
                  ? `InsightFace đang chạy (${info.faces.photos} ảnh đã enroll)`
                  : "Chưa cài InsightFace — xem hướng dẫn ở trang Người quen"}
              </div>
            </div>
            <Switch checked={!!form.face_enabled} onCheckedChange={(v) => setForm((f) => ({ ...f, face_enabled: v }))} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm">Cảnh báo người lạ</div>
              <div className="text-[11px] text-muted-foreground">Tạo sự kiện "Người lạ" khi thấy mặt không quen</div>
            </div>
            <Switch checked={!!form.stranger_alert} onCheckedChange={(v) => setForm((f) => ({ ...f, stranger_alert: v }))} />
          </div>
          <div>
            <Label>Độ chính xác khớp: {(Number(form.face_threshold ?? 0.38)).toFixed(2)}</Label>
            <input
              type="range" min={25} max={55} step={1}
              value={Number(form.face_threshold ?? 0.38) * 100}
              onChange={(e) => setForm((f) => ({ ...f, face_threshold: Number(e.target.value) / 100 }))}
              className="w-full accent-[hsl(var(--primary))] mt-2"
            />
            <p className="text-[11px] text-muted-foreground/70">Cao = ít nhầm nhưng có thể bỏ sót.</p>
          </div>
          <Button onClick={save} loading={busy}>
            <Save className="h-4 w-4" /> Lưu
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

/* ================= Notifications tab ================= */

function useSettings() {
  return useQuery<NvrSettings>({
    queryKey: ["settings"],
    queryFn: () => api.get("/settings"),
  });
}

function NotifyTab() {
  const { data: settings } = useSettings();
  const { toast } = useToast();
  const [form, setForm] = useState<Partial<NvrSettings>>({});
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (settings) setForm(settings);
  }, [settings]);

  const save = async () => {
    setBusy(true);
    try {
      await api.put("/settings", {
        values: {
          notify_enabled: !!form.notify_enabled,
          notify_types: form.notify_types ?? "person,face_stranger",
          notify_cooldown: Number(form.notify_cooldown ?? 180),
          telegram_token: form.telegram_token ?? "",
          telegram_chat_id: String(form.telegram_chat_id ?? ""),
          pushover_token: form.pushover_token ?? "",
          pushover_user: form.pushover_user ?? "",
          quiet_hours_enabled: !!form.quiet_hours_enabled,
          quiet_from: form.quiet_from ?? "22:30",
          quiet_to: form.quiet_to ?? "06:00",
        },
      });
      toast("success", "Đã lưu cài đặt thông báo");
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Lỗi lưu");
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      const r = await api.post<{ ok: boolean; message: string }>("/settings/test-notify");
      r.ok ? toast("success", r.message) : toast("error", r.message);
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Lỗi test");
    } finally {
      setTesting(false);
    }
  };

  const types = (form.notify_types ?? "").split(",").filter(Boolean);

  return (
    <div className="space-y-3 max-w-xl">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BellRing className="h-4 w-4 text-primary" /> Thông báo đẩy
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm">Bật thông báo</div>
              <div className="text-[11px] text-muted-foreground">Gửi khi có sự kiện phù hợp (kèm ảnh)</div>
            </div>
            <Switch checked={!!form.notify_enabled} onCheckedChange={(v) => setForm((f) => ({ ...f, notify_enabled: v }))} />
          </div>

          <div>
            <Label>Loại sự kiện được gửi</Label>
            <div className="flex flex-wrap gap-1.5">
              {["person", "car", "cat", "dog", "motion", "face_stranger"].map((t) => {
                const labels: Record<string, string> = {
                  person: "Người", car: "Xe", cat: "Mèo", dog: "Chó",
                  motion: "Chuyển động", face_stranger: "Người lạ",
                };
                const active = types.includes(t);
                return (
                  <button
                    key={t}
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        notify_types: active
                          ? types.filter((x) => x !== t).join(",")
                          : [...types, t].join(","),
                      }))
                    }
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs transition-colors",
                      active ? "border-primary/50 bg-primary/15 text-primary" : "border-border text-muted-foreground",
                    )}
                  >
                    {labels[t]}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="border-t border-border/60 pt-3 space-y-3">
            <div className="text-xs font-semibold text-muted-foreground">Telegram</div>
            <div>
              <Label>Bot token</Label>
              <Input
                value={form.telegram_token ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, telegram_token: e.target.value }))}
                placeholder="123456:ABC-DEF..."
                className="font-mono text-xs"
              />
            </div>
            <div>
              <Label>Chat ID</Label>
              <Input
                value={form.telegram_chat_id ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, telegram_chat_id: e.target.value }))}
                placeholder="VD: 123456789"
                className="font-mono text-xs"
              />
              <p className="text-[11px] text-muted-foreground/70 mt-1">
                Nhắn tin cho <b>@userinfobot</b> để lấy Chat ID của bạn.
              </p>
            </div>
          </div>

          <div className="border-t border-border/60 pt-3 space-y-3">
            <div className="text-xs font-semibold text-muted-foreground">Pushover (tùy chọn)</div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label>App token</Label>
                <Input value={form.pushover_token ?? ""} onChange={(e) => setForm((f) => ({ ...f, pushover_token: e.target.value }))} className="font-mono text-xs" />
              </div>
              <div>
                <Label>User key</Label>
                <Input value={form.pushover_user ?? ""} onChange={(e) => setForm((f) => ({ ...f, pushover_user: e.target.value }))} className="font-mono text-xs" />
              </div>
            </div>
          </div>

          <div className="border-t border-border/60 pt-3 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm">Giờ yên tĩnh</div>
                <div className="text-[11px] text-muted-foreground">Không gửi thông báo trong khung giờ này</div>
              </div>
              <Switch checked={!!form.quiet_hours_enabled} onCheckedChange={(v) => setForm((f) => ({ ...f, quiet_hours_enabled: v }))} />
            </div>
            {form.quiet_hours_enabled && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Từ</Label>
                  <Input type="time" value={form.quiet_from ?? "22:30"} onChange={(e) => setForm((f) => ({ ...f, quiet_from: e.target.value }))} />
                </div>
                <div>
                  <Label>Đến</Label>
                  <Input type="time" value={form.quiet_to ?? "06:00"} onChange={(e) => setForm((f) => ({ ...f, quiet_to: e.target.value }))} />
                </div>
              </div>
            )}
            <div>
              <Label>Thời gian chờ giữa 2 lần gửi (giây)</Label>
              <Input
                type="number" min={30} max={3600}
                value={form.notify_cooldown ?? 180}
                onChange={(e) => setForm((f) => ({ ...f, notify_cooldown: Number(e.target.value) }))}
              />
            </div>
          </div>

          <div className="flex gap-2">
            <Button onClick={save} loading={busy}>
              <Save className="h-4 w-4" /> Lưu
            </Button>
            <Button variant="outline" onClick={test} disabled={testing}>
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Gửi thông báo test
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ================= System tab ================= */

function SystemTab() {
  const { data: info } = useSystemInfo();
  const { toast } = useToast();
  const [oldPass, setOldPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  const changePass = async () => {
    setBusy(true);
    try {
      await api.post("/auth/password", { old_password: oldPass, new_password: newPass });
      toast("success", "Đã đổi mật khẩu");
      setOldPass(""); setNewPass("");
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Lỗi đổi mật khẩu");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 max-w-xl">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" /> Tài khoản
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>Mật khẩu hiện tại</Label>
            <div className="relative">
              <Input
                type={show ? "text" : "password"}
                value={oldPass}
                onChange={(e) => setOldPass(e.target.value)}
                className="pr-10"
              />
              <button className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => setShow((s) => !s)} type="button">
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div>
            <Label>Mật khẩu mới (tối thiểu 6 ký tự)</Label>
            <Input type={show ? "text" : "password"} value={newPass} onChange={(e) => setNewPass(e.target.value)} />
          </div>
          <Button onClick={changePass} loading={busy} disabled={!oldPass || newPass.length < 6}>
            Đổi mật khẩu
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-4 w-4 text-primary" /> Hệ thống
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground space-y-2">
          <div className="flex justify-between"><span>Phiên bản</span><b className="text-foreground">{info?.version}</b></div>
          <div className="flex justify-between"><span>Múi giờ</span><b className="text-foreground">{info?.timezone}</b></div>
          <div className="flex justify-between"><span>Uptime</span><b className="text-foreground">{Math.floor((info?.uptime ?? 0) / 3600)}h {Math.floor(((info?.uptime ?? 0) % 3600) / 60)}m</b></div>
          <div className="flex justify-between"><span>AI engine</span><b className="text-foreground">{info?.detection.backend === "yolo" ? "YOLOv8n ONNX" : "Motion (fallback)"}</b></div>
          <div className="flex justify-between"><span>go2rtc</span><b className="text-foreground font-mono">{info?.go2rtc_url}</b></div>
          <p className="pt-2 leading-relaxed">
            Truy cập ngoài nhà: khuyến nghị dùng <b>Tailscale</b> (miễn phí) thay vì mở port router.
            Xem hướng dẫn trong README của dự án.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

/* ================= Page ================= */

export default function SettingsPage() {
  const [tab, setTab] = useState("cameras");
  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-2.5">
        <h1 className="text-lg font-semibold tracking-tight">Cài đặt</h1>
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "cameras", label: "Camera" },
          { value: "storage", label: "Lưu trữ & AI" },
          { value: "notify", label: "Thông báo" },
          { value: "system", label: "Hệ thống" },
        ]}
      />
      {tab === "cameras" && <CamerasTab />}
      {tab === "storage" && <StorageAiTab />}
      {tab === "notify" && <NotifyTab />}
      {tab === "system" && <SystemTab />}
    </div>
  );
}
