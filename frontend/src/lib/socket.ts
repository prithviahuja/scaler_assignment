/**
 * Websocket client with heartbeat and exponential-backoff reconnect.
 *
 * It owns no application state — it hands every decoded frame to the handler
 * the store registers, and exposes typed senders for the outbound frames.
 */

import { websocketUrl } from "./api";
import type { ServerEvent } from "./types";

type EventHandler = (event: ServerEvent) => void;
type StatusHandler = (status: SocketStatus) => void;

export type SocketStatus = "connecting" | "open" | "closed";

const HEARTBEAT_MS = 25_000;
const MAX_BACKOFF_MS = 15_000;

export class SignalSocket {
  private socket: WebSocket | null = null;
  private token: string | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;
  private closedByUs = false;

  constructor(
    private readonly onEvent: EventHandler,
    private readonly onStatus: StatusHandler,
  ) {}

  connect(token: string): void {
    this.token = token;
    this.closedByUs = false;
    this.open();
  }

  private open(): void {
    if (!this.token) return;
    this.clearTimers();
    this.onStatus("connecting");

    const socket = new WebSocket(websocketUrl(this.token));
    this.socket = socket;

    socket.onopen = () => {
      this.attempts = 0;
      this.onStatus("open");
      this.heartbeat = setInterval(() => this.send("ping", {}), HEARTBEAT_MS);
    };

    socket.onmessage = (raw) => {
      try {
        this.onEvent(JSON.parse(raw.data) as ServerEvent);
      } catch {
        /* ignore malformed frames */
      }
    };

    socket.onclose = () => {
      this.onStatus("closed");
      this.clearTimers();
      if (!this.closedByUs) this.scheduleReconnect();
    };

    // `onclose` always follows `onerror`, so reconnection is handled there.
    socket.onerror = () => socket.close();
  }

  private scheduleReconnect(): void {
    this.attempts += 1;
    const delay = Math.min(1000 * 2 ** (this.attempts - 1), MAX_BACKOFF_MS);
    this.retryTimer = setTimeout(() => this.open(), delay);
  }

  private clearTimers(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.heartbeat = null;
    this.retryTimer = null;
  }

  disconnect(): void {
    this.closedByUs = true;
    this.clearTimers();
    this.socket?.close();
    this.socket = null;
    this.token = null;
  }

  private send(type: string, payload: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type, payload }));
    }
  }

  sendTyping(conversationId: number, isTyping: boolean): void {
    this.send("typing", { conversation_id: conversationId, is_typing: isTyping });
  }

  sendDelivered(messageIds: number[]): void {
    if (messageIds.length) this.send("delivered", { message_ids: messageIds });
  }

  sendRead(conversationId: number): void {
    this.send("read", { conversation_id: conversationId });
  }
}
