// imports here

import * as http from "node:http";

// SseServer class here
export class SseServer {
  private _res: http.ServerResponse;
  private _lastEventId?: string;

  constructor(res: http.ServerResponse, lastEventId?: string) {
    this._res = res;
    this._lastEventId = lastEventId;
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
