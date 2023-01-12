// imports here
import { AppShPlugin, AppShPluginConfig } from "./app-sh.js";

import * as http from "node:http";
import * as os from "node:os";

// Interfaces here
export type Middleware = {
  (next: () => void): void;
};

export interface HttpConfig {
  keepAliveTimeout?: number;
  headerTimeout?: number;

  networkInterface?: string;
  networkPort?: number;

  healthcheckPath?: string;
  healthcheckGoodRes?: number;
  healthcheckBadRes?: number;
}

// Config consts here
const CFG_HTTP_KEEP_ALIVE_TIMEOUT = "HTTP_KEEP_ALIVE_TIMEOUT";
const CFG_HTTP_HEADER_TIMEOUT = "HTTP_HEADER_TIMEOUT";

const CFG_HTTP_NETWORK_INTERFACE = "HTTP_NETWORK_INTERFACE";
const CFG_HTTP_NETWORK_PORT = "HTTP_NETWORK_PORT";

const CFG_HTTP_HEALTHCHECK_PATH = "HTTP_HEALTHCHECK_PATH";
const CFG_HTTP_HEALTHCHECK_GOOD_RES = "HTTP_HEALTHCHECK_GOOD_RES";
const CFG_HTTP_HEALTHCHECK_BAD_RES = "HTTP_HEALTHCHECK_BAD_RES";

// Default configs here
const DEFAULT_HTTP_CONFIG = {
  keepAliveTimeout: 65000,
  headerTimeout: 66000,

  networkInterface: "",
  networkPort: 8080,

  healthcheckPath: "/healthcheck",
  healthcheckGoodRes: 200,
  healthcheckBadRes: 503,
};

// HttpMan class here
export class HttpMan extends AppShPlugin {
  private _middlewareList: Middleware[];

  private _httpKeepAliveTimeout: number;
  private _httpHeaderTimeout: number;

  private _networkInterface: string;
  private _networkPort: number;

  private _healthCheckPath: string;
  private _healthCheckGoodResCode: number;
  private _healthCheckBadResCode: number;

  private _server?: http.Server;

  constructor(extConfig: AppShPluginConfig, passedConfig: HttpConfig = {}) {
    super(extConfig);

    let config = {
      ...DEFAULT_HTTP_CONFIG,
      ...passedConfig,
    };

    this._middlewareList = [];

    this._httpKeepAliveTimeout = this.getConfigNum(
      CFG_HTTP_KEEP_ALIVE_TIMEOUT,
      config.keepAliveTimeout,
    );

    this._httpHeaderTimeout = this.getConfigNum(
      CFG_HTTP_HEADER_TIMEOUT,
      config.headerTimeout,
    );

    this._networkInterface = this.getConfigStr(
      CFG_HTTP_NETWORK_INTERFACE,
      config.networkInterface,
    );

    this._networkPort = this.getConfigNum(
      CFG_HTTP_NETWORK_PORT,
      config.networkPort,
    );

    this._healthCheckPath = this.getConfigStr(
      CFG_HTTP_HEALTHCHECK_PATH,
      config.healthcheckPath,
    );

    this._healthCheckGoodResCode = this.getConfigNum(
      CFG_HTTP_HEALTHCHECK_GOOD_RES,
      config.healthcheckGoodRes,
    );

    this._healthCheckBadResCode = this.getConfigNum(
      CFG_HTTP_HEALTHCHECK_BAD_RES,
      config.healthcheckBadRes,
    );
  }

  // Private methods here
  private setupHealthcheck(): void {
    if (this._networkInterface.length === 0) {
      this.startup(
        "No HTTP interface specified for healthcheck endpoint - healthcheck disabled!",
      );
      return;
    }

    this.startup("Initialising healthcheck HTTP endpoint ...");

    this.startup(`Finding IP for interface (${this._networkInterface})`);

    let ifaces = os.networkInterfaces();
    this.startup("Interfaces on host: %j", ifaces);

    if (ifaces[this._networkInterface] === undefined) {
      throw new Error(
        `${this._networkInterface} is not an interface on this server`,
      );
    }

    let ip = "";

    // Search for the first I/F with a family of type IPv4
    let found = ifaces[this._networkInterface]?.find(
      (i) => i.family === "IPv4",
    );
    if (found !== undefined) {
      ip = found.address;
      this.startup(`Found IP (${ip}) for interface ${this._networkInterface}`);
      this.startup(
        `Will listen on interface ${this._networkInterface} (IP: ${ip})`,
      );
    }

    if (ip.length === 0) {
      throw new Error(
        `${this._networkInterface} is not an interface on this server`,
      );
    }

    this.startup(`Attempting to listen on (http://${ip}:${this._networkPort})`);

    this._server = http
      .createServer((req, res) => this.healthcheckCallback(req, res))
      .listen(this._networkPort, ip);

    // NOTE: The default node keep alive is 5 secs. This needs to be set
    // higher then any load balancers in front of this CNA

    this._server.keepAliveTimeout = this._httpKeepAliveTimeout;

    // NOTE: There is a potential race condition and the recommended
    // solution is to make the header timeouts greater then the keep alive
    // timeout. See - https://github.com/nodejs/node/issues/27363

    this._server.headersTimeout = this._httpHeaderTimeout;

    this.startup("Now listening. Healthcheck endpoint enabled!");
  }

  private async healthcheckCallback(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    // We will only run a healthcheck if this is a GET on the healthcheck path
    if (
      req.method?.toLowerCase() !== "get" ||
      req.url !== this._healthCheckPath
    ) {
      res.statusCode = 404;
      res.end();
      return;
    }

    // TODO: This doesn't make sense - this needs to call the healthcheck for the shell
    let healthy = await this.healthCheck().catch((e) => {
      this.error(e);
    });

    if (healthy) {
      res.statusCode = this._healthCheckGoodResCode;
    } else {
      res.statusCode = this._healthCheckBadResCode;
    }

    res.end();
  }

  // Public methods here
  async start(): Promise<boolean> {
    this.setupHealthcheck();
    return true;
  }

  async stop(): Promise<void> {
    if (this._server !== undefined) {
      this.shutdown("Closing healthcheck endpoint port now ...");
      this._server.close();
      this.shutdown("Port closed");
    }

    return;
  }

  addMiddleware(middleware: Middleware): void {
    this._middlewareList.push(middleware);
  }

  async callMiddleware(middlewareStack: Middleware[]): Promise<void> {
    // If there is a middleware to call
    if (middlewareStack.length) {
      // Then call it and pass the remaining middlewareList in the next()
      middlewareStack[0](async () => {
        await this.callMiddleware(middlewareStack.slice(1));
      });
    } else {
      console.log("call the router now");
    }
  }
}
