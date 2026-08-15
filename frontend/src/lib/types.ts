export interface Camera {
  id: number;
  name: string;
  slug: string;
  url_main: string;
  url_sub: string;
  enabled: boolean;
  record_mode: "continuous" | "motion" | "off";
  detect_enabled: boolean;
  detect_fps: number;
  detect_classes: string;
  detect_threshold: number;
  zones: number[][];
  ptz_enabled: boolean;
  onvif_url: string;
  onvif_user: string;
  status: "online" | "offline" | "error";
  last_frame_at: string | null;
  last_error: string;
  has_ptz: boolean;
}

export interface NvrEvent {
  id: number;
  camera_id: number;
  camera_name: string;
  type: string;
  label: string;
  score: number;
  ts_start: string;
  ts_end: string;
  has_snapshot: boolean;
  notified: boolean;
}

export interface SystemInfo {
  version: string;
  uptime: number;
  timezone: string;
  go2rtc_url: string;
  cameras: { total: number; enabled: number; online: number };
  detection: { backend: string; cameras: Record<string, boolean> };
  faces: { available: boolean; photos: number };
  disk: { total_gb: number; used_gb: number; free_gb: number; percent: number };
  cpu_percent: number;
  memory_percent: number | null;
}

export interface NvrSettings {
  retention_days: number;
  max_storage_gb: number;
  detector_backend: string;
  face_enabled: boolean;
  face_threshold: number;
  stranger_alert: boolean;
  notify_enabled: boolean;
  notify_types: string;
  notify_cooldown: number;
  telegram_token: string;
  telegram_chat_id: string;
  pushover_token: string;
  pushover_user: string;
  quiet_hours_enabled: boolean;
  quiet_from: string;
  quiet_to: string;
  go2rtc_public_url: string;
  [k: string]: unknown;
}

export interface KnownFaceItem {
  id: number;
  name: string;
  note: string;
  photos: number[];
  created_at: string;
  last_seen: string | null;
}

export interface Segment {
  start: number; // giây từ đầu ngày (local)
  end: number;
  duration: number;
  file: string;
  size: number;
}

export const EVENT_META: Record<string, { label: string; color: string }> = {
  person: { label: "Người", color: "#4f7cff" },
  car: { label: "Ô tô", color: "#f59e0b" },
  cat: { label: "Mèo", color: "#a78bfa" },
  dog: { label: "Chó", color: "#f472b6" },
  motion: { label: "Chuyển động", color: "#64748b" },
  face_stranger: { label: "Người lạ", color: "#ef4444" },
};
