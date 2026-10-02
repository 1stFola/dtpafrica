declare module "ws" {
  import type { IncomingMessage } from "node:http";
  import type { Duplex } from "node:stream";

  export class WebSocket {
    static readonly OPEN: number;
    readonly readyState: number;
    readonly bufferedAmount: number;
    send(data: string): void;
    close(code?: number, reason?: string): void;
    on(event: "message", listener: (data: { toString(): string }) => void): this;
    on(event: "close", listener: () => void): this;
  }

  export class WebSocketServer {
    constructor(options: { noServer: boolean; maxPayload?: number });
    handleUpgrade(
      request: IncomingMessage,
      socket: Duplex,
      head: Buffer,
      callback: (ws: WebSocket) => void
    ): void;
    close(): void;
  }
}
