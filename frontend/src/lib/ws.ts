/** WebSocket realtime duy nhất cho cả app (tự reconnect). */
import { useEffect } from "react";
import { auth } from "./api";

type Handler = (msg: any) => void;

class WsClient {
  private ws: WebSocket | null = null;
  private handlers = new Set<Handler>();
  private retry = 0;
  private timer: number | null = null;

  connect() {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
    const token = auth.getToken();
    if (!token) return;
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    try {
      this.ws = new WebSocket(`${proto}://${window.location.host}/api/ws?token=${token}`);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        this.handlers.forEach((h) => h(data));
      } catch {
        /* ignore */
      }
    };
    this.ws.onclose = () => {
      this.ws = null;
      if (auth.getToken()) this.scheduleReconnect();
    };
    this.ws.onerror = () => this.ws?.close();
  }

  private scheduleReconnect() {
    if (this.timer) return;
    const delay = Math.min(3000 * ++this.retry, 15000);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.connect();
    }, delay);
  }

  subscribe(h: Handler) {
    this.handlers.add(h);
    this.connect();
    return () => {
      this.handlers.delete(h);
    };
  }
}

export const wsClient = new WsClient();

/** Hook: lắng nghe message WS (đã lọc theo type nếu truyền vào). */
export function useWs(type: string | null, handler: Handler) {
  useEffect(() => {
    return wsClient.subscribe((msg) => {
      if (type === null || msg.type === type || msg.type === "hello") handler(msg);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);
}
