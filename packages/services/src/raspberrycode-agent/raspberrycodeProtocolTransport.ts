import type { Event, IDisposable } from "@raspberrycode/rpc";
import type { RaspberryCodeProtocolMessage } from "@raspberrycode/shared";

export type RaspberryCodeProtocolTransportKind = "stdio" | "websocket" | "memory";

export interface RaspberryCodeProtocolTransportClosedEvent {
  code?: number | null;
  signal?: NodeJS.Signals | null;
  reason?: string;
}

export interface RaspberryCodeProtocolTransport extends IDisposable {
  readonly kind: RaspberryCodeProtocolTransportKind;
  readonly onMessage: Event<RaspberryCodeProtocolMessage>;
  readonly onClose: Event<RaspberryCodeProtocolTransportClosedEvent>;
  send(message: RaspberryCodeProtocolMessage): Promise<void>;
  disposeAndWait?(): Promise<void>;
}
