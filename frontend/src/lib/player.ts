/** MSE player cho go2rtc /api/stream.mp4 — độ trễ thấp, tự reconnect. */

const FALLBACK_MIMES = [
  'video/mp4; codecs="avc1.64003E, mp4a.40.2"',
  'video/mp4; codecs="avc1.640029, mp4a.40.2"',
  'video/mp4; codecs="avc1.42E01E, mp4a.40.2"',
  'video/mp4; codecs="avc1.64003E"',
  'video/mp4; codecs="avc1.42E01E"',
  "video/mp4",
];

export interface StreamHandle {
  stop: () => void;
}

export function attachStream(
  video: HTMLVideoElement,
  base: string,
  src: string,
  onStatus?: (s: "connecting" | "playing" | "error") => void,
): StreamHandle {
  let stopped = false;
  const abort = new AbortController();
  let retryTimer: number | null = null;
  let latencyTimer: number | null = null;

  const scheduleRetry = () => {
    if (stopped || retryTimer) return;
    retryTimer = window.setTimeout(() => {
      retryTimer = null;
      start();
    }, 4000);
  };

  const start = async () => {
    if (stopped) return;
    onStatus?.("connecting");
    try {
      // mime từ codec-info của go2rtc
      let mimes: string[] = [];
      try {
        const ci = await fetch(`${base}/api/codec-info?src=${encodeURIComponent(src)}`, {
          signal: abort.signal,
        }).then((r) => r.json());
        const arr = Array.isArray(ci) ? ci : [ci];
        const codecs = arr
          .map((t: any) => t?.codec ?? t?.codec_mime ?? t?.codecs)
          .filter(Boolean);
        if (codecs.length) mimes.push(`video/mp4; codecs="${codecs.join(", ")}"`);
      } catch {
        /* dùng fallback */
      }
      mimes.push(...FALLBACK_MIMES);

      const ms = new MediaSource();
      video.src = URL.createObjectURL(ms);
      await new Promise<void>((res) => {
        ms.addEventListener("sourceopen", () => res(), { once: true });
      });
      if (stopped) return;

      let sb: SourceBuffer | null = null;
      for (const mime of mimes) {
        try {
          sb = ms.addSourceBuffer(mime);
          break;
        } catch {
          /* thử mime kế */
        }
      }
      if (!sb) throw new Error("Trình duyệt không hỗ trợ codec của stream");

      const queue: Uint8Array[] = [];
      let busy = false;
      const pump = () => {
        if (busy || sb!.updating || !queue.length) return;
        busy = true;
        try {
          // Uint8Array từ ReadableStream — cast chuẩn cho SourceBuffer
          sb!.appendBuffer(queue.shift()! as unknown as BufferSource);
        } catch {
          busy = false;
        }
      };
      sb.addEventListener("updateend", () => {
        busy = false;
        pump();
      });

      const resp = await fetch(`${base}/api/stream.mp4?src=${encodeURIComponent(src)}`, {
        signal: abort.signal,
      });
      if (!resp.ok || !resp.body) throw new Error(`stream.mp4 HTTP ${resp.status}`);
      const reader = resp.body.getReader();
      onStatus?.("playing");
      while (!stopped) {
        const { done, value } = await reader.read();
        if (done) break;
        queue.push(value);
        if (queue.length > 24) queue.splice(0, queue.length - 12); // không dồn buffer
        pump();
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      onStatus?.("error");
      scheduleRetry();
      return;
    }
    if (!stopped) scheduleRetry(); // stream kết thúc -> mở lại
  };

  // giữ độ trễ thấp: nếu tụt hơn 2s thì nhảy tới mép buffer
  latencyTimer = window.setInterval(() => {
    try {
      const b = video.buffered;
      if (b.length && b.end(b.length - 1) - video.currentTime > 2) {
        video.currentTime = b.end(b.length - 1) - 0.4;
      }
    } catch {
      /* ignore */
    }
  }, 4000);

  start();

  return {
    stop: () => {
      stopped = true;
      abort.abort();
      if (retryTimer) clearTimeout(retryTimer);
      if (latencyTimer) clearInterval(latencyTimer);
      try {
        video.pause();
      } catch { /* ignore */ }
      video.removeAttribute("src");
      video.load();
    },
  };
}
