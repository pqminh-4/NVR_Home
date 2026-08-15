import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Users, UserPlus, Trash2, AlertCircle } from "lucide-react";
import { api } from "../../lib/api";
import type { KnownFaceItem } from "../../lib/types";
import { Button } from "../../components/ui/button";
import { Input, Label, Textarea } from "../../components/ui/input";
import { Dialog } from "../../components/ui/dialog";
import { Skeleton, EmptyState } from "../../components/ui/misc";
import { useToast } from "../../components/ui/toast";
import { fmtAgo } from "../../lib/format";

export default function FacesPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery<{ available: boolean; items: KnownFaceItem[] }>({
    queryKey: ["faces"],
    queryFn: () => api.get("/faces"),
  });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const pick = (fl: FileList | null) => {
    if (!fl) return;
    const arr = Array.from(fl).slice(0, 10);
    setFiles(arr);
    setPreviews(arr.map((f) => URL.createObjectURL(f)));
  };

  const submit = async () => {
    if (!name.trim() || files.length === 0) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("name", name.trim());
      fd.append("note", note.trim());
      files.forEach((f) => fd.append("files", f));
      await api.post("/faces", fd);
      toast("success", `Đã thêm ${name.trim()} vào danh sách người quen`);
      qc.invalidateQueries({ queryKey: ["faces"] });
      setOpen(false);
      setName(""); setNote(""); setFiles([]); setPreviews([]);
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Lỗi thêm người quen");
    } finally {
      setBusy(false);
    }
  };

  const del = async (f: KnownFaceItem) => {
    if (!confirm(`Xoá "${f.name}" khỏi danh sách người quen?`)) return;
    try {
      await api.del(`/faces/${f.id}`);
      qc.invalidateQueries({ queryKey: ["faces"] });
      toast("success", "Đã xoá");
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Lỗi xoá");
    }
  };

  const faces = data?.items ?? [];

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <Users className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold tracking-tight">Người quen</h1>
          <span className="text-xs text-muted-foreground">{faces.length} người</span>
        </div>
        <Button onClick={() => setOpen(true)}>
          <UserPlus className="h-4 w-4" />
          Thêm người quen
        </Button>
      </div>

      {data && !data.available && (
        <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-xs leading-relaxed">
          <AlertCircle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
          <div>
            <b>Chưa bật nhận diện khuôn mặt.</b> Trên NAS chạy:
            <code className="mx-1 px-1.5 py-0.5 rounded bg-muted">docker exec nvr-home pip install -r backend/requirements-faces.txt</code>
            rồi restart (docker compose restart nvr). Trên máy dev:
            <code className="mx-1 px-1.5 py-0.5 rounded bg-muted">.venv/Scripts/pip install -r backend/requirements-faces.txt</code>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="w-full" style={{ aspectRatio: "3/4" }} />)}
        </div>
      ) : faces.length === 0 ? (
        <div className="card-surface">
          <EmptyState
            icon={<Users className="h-10 w-10" />}
            title="Danh sách trống"
            description="Thêm ảnh người thân — khi camera nhận diện được, sự kiện sẽ gắn tên họ và bạn có thể nhận cảnh báo người lạ."
            action={<Button onClick={() => setOpen(true)}>Thêm người đầu tiên</Button>}
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {faces.map((f) => (
            <div key={f.id} className="group card-surface overflow-hidden hover:border-primary/40 transition-colors">
              <div className="relative bg-muted" style={{ aspectRatio: "3/4" }}>
                {f.photos[0] !== undefined && (
                  <img
                    src={`/api/faces/${f.id}/photo/${f.photos[0]}`}
                    alt={f.name}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                )}
                {f.photos.length > 1 && (
                  <span className="absolute top-2 right-2 rounded-full bg-black/60 text-white text-[10px] px-2 py-0.5">
                    +{f.photos.length - 1} ảnh
                  </span>
                )}
                <button
                  onClick={() => del(f)}
                  className="absolute bottom-2 right-2 p-2 rounded-lg bg-black/60 text-white/90 opacity-0 group-hover:opacity-100 hover:bg-destructive transition-all"
                  title="Xoá"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <div className="p-3">
                <div className="text-sm font-medium truncate">{f.name}</div>
                <div className="text-[11px] text-muted-foreground">
                  {f.last_seen ? `Thấy ${fmtAgo(f.last_seen)}` : "Chưa gặp"}
                </div>
                {f.note && <div className="text-[11px] text-muted-foreground/70 mt-0.5 truncate">{f.note}</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} title="Thêm người quen">
        <div className="space-y-4">
          <div>
            <Label>Tên *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="VD: Bố, Mẹ, Chị Lan…" autoFocus />
          </div>
          <div>
            <Label>Ghi chú</Label>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Tuỳ chọn" rows={2} />
          </div>
          <div>
            <Label>Ảnh (2–10 ảnh, chụp rõ mặt)</Label>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => pick(e.target.files)}
            />
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full border border-dashed border-border rounded-lg py-6 text-xs text-muted-foreground hover:border-primary/50 hover:text-foreground transition-colors"
            >
              Bấm chọn ảnh từ thiết bị
            </button>
            {previews.length > 0 && (
              <div className="flex gap-2 flex-wrap mt-3">
                {previews.map((p, i) => (
                  <img key={i} src={p} alt="" className="h-16 w-16 rounded-md object-cover border border-border" />
                ))}
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Huỷ</Button>
            <Button onClick={submit} loading={busy} disabled={!name.trim() || files.length === 0}>
              Lưu người quen
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
