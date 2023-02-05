// imports here

import * as http from "node:http";

export type SseServerOptions = {
  retryInterval?: number; // In seconds
  pingInterval?: number; // In seconds
  pingEvent?: string;
};

// SseServer class here
export class SseServer {
  private _res: http.ServerResponse;
  private _lastEventId?: string;

  constructor(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    sseOptions: SseServerOptions,
  ) {
    let opts = {
      // Defaults first
      pingEvent: "ping",

      ...sseOptions,
    };

    this._res = res;
    this._lastEventId = <string>req.headers["last-event-id"];

    // Set up the basics first
    req.socket.setKeepAlive(true);
    req.socket.setNoDelay(true);
    req.socket.setTimeout(0);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Cache-Control", "no-cache");
    res.statusCode = 200;

    // Check if we should set a new delay interval
    if (opts.retryInterval !== undefined) {
      this.setRetry(opts.retryInterval);
    }

    // Check if we should setup a heartbeat ping
    if (opts.pingInterval !== undefined) {
      let event = opts.pingEvent === undefined ? "ping" : opts.pingEvent;

      // We will pass an incremental seqNum with the heartbeat
      let seqNum = 0;

      // Setup a timer to send the heartbeat
      let interval = setInterval(() => {
        this.sendData(seqNum, { event });
        seqNum += 1;
      }, opts.pingInterval * 1000);

      // Make sure to stop the timer if the connection closes
      res.addListener("close", () => {
        clearInterval(interval);
      });
    }
  }

  get lastEventId(): string | undefined {
    return this._lastEventId;
  }

  setRetry(delay: number): void {
    this._res.write(`retry: ${delay}\n\n`);
  }

  sendData(
    data: object | unknown[] | string | number,
    options: {
      event?: string;
      id?: number;
    },
  ): void {
    if (options?.event !== undefined) {
      this._res.write(`event: ${options.event}\n`);
    }

    if (options?.id !== undefined) {
      this._res.write(`id: ${options.id}\n`);
    }

    // Rem an array is an object!
    if (typeof data === "object") {
      this._res.write(`data: ${JSON.stringify(data)}\n\n`);
    } else {
      this._res.write(`data: ${data}\n\n`);
    }
  }

  close(): void {
    this._res.end();
  }
}
