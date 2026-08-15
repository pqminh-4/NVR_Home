import { useState, type FormEvent } from "react";
import { motion } from "framer-motion";
import { Camera, Lock, User } from "lucide-react";
import { api, auth } from "../../lib/api";
import { Button } from "../../components/ui/button";
import { Input, Label } from "../../components/ui/input";

export default function LoginPage() {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const resp = await api.post<{ token: string }>("/auth/login", { username, password });
      auth.setToken(resp.token);
      window.location.href = "/live";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Đăng nhập thất bại");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-full flex items-center justify-center p-4 bg-background relative overflow-hidden">
      {/* nền trang trí */}
      <div className="absolute -top-32 -left-32 h-96 w-96 rounded-full bg-primary/10 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-primary/5 blur-3xl pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="relative w-full max-w-sm"
      >
        <div className="flex flex-col items-center mb-8">
          <div className="h-16 w-16 rounded-2xl bg-primary/15 border border-primary/30 flex items-center justify-center mb-4 shadow-glow">
            <Camera className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-xl font-bold tracking-tight">
            NVR<span className="text-primary">_Home</span>
          </h1>
          <p className="text-xs text-muted-foreground mt-1">Quản lý camera tại nhà</p>
        </div>

        <form onSubmit={submit} className="card-surface p-6 space-y-4">
          <div>
            <Label>Tên đăng nhập</Label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60" />
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="pl-9"
                autoComplete="username"
                required
              />
            </div>
          </div>
          <div>
            <Label>Mật khẩu</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60" />
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pl-9"
                autoComplete="current-password"
                autoFocus
                required
              />
            </div>
          </div>

            {error && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-xs text-destructive bg-destructive/10 border border-destructive/25 rounded-md px-3 py-2"
            >
              {error}
            </motion.p>
          )}

          <Button type="submit" className="w-full" size="lg" loading={loading}>
            Đăng nhập
          </Button>

          <p className="text-[11px] text-muted-foreground/60 text-center leading-relaxed">
            Mật khẩu mặc định lấy từ biến <code className="text-primary/80">NVR_ADMIN_PASSWORD</code> trong file .env — đổi trong Cài đặt sau khi đăng nhập.
          </p>
        </form>
      </motion.div>
    </div>
  );
}
