// imports here
import { AppSh, Logger } from "./app-sh.js";

import { match, MatchFunction } from "path-to-regexp";
import { z } from "zod";

import * as http from "node:http";
import * as https from "node:https";
import * as os from "node:os";
import * as fs from "node:fs";

export { z };

// Types and Interfaces here
type MiddlewareNext = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  details: EndpointCallbackDetails,
  middlewareStack: Middleware[],
  callback: EndpointCallback,
) => Promise<void>;

export type Middleware = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  details: EndpointCallbackDetails,
  next: MiddlewareNext,
) => Promise<void>;

export type HealthcheckCallback = () => Promise<boolean>;

export type EndpointCallbackDetails = {
  url: URL;
  params: object;
  body?: Buffer;
  jsonBody?: unknown;
};

export type EndpointCallback = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  details: EndpointCallbackDetails,
) => Promise<void>;

export type EndpointOptions = {
  maxBodySize?: number;
  zodInputValidator?: z.ZodTypeAny;
};

export interface HttpConfig {
  appSh: AppSh;

  // NOTE: The default node keep alive is 5 secs. This needs to be set
  // higher then any load balancers in front of this App
  keepAliveTimeout?: number;
  // NOTE: There is a potential race condition and the recommended
  // solution is to make the header timeouts greater then the keep alive
  // timeout. See - https://github.com/nodejs/node/issues/27363
  headerTimeout?: number;

  networkInterface?: string;
  networkPort?: number;

  healthcheckPath?: string;
  healthcheckGoodRes?: number;
  healthcheckBadRes?: number;

  enableHttps?: boolean;
}

interface MethodListElement {
  matchFunc: MatchFunction<object>;
  callback: EndpointCallback;
  options: EndpointOptions;
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

// Default configs here
const DEFAULT_ENDPOINT_OPTIONS = {
  maxBodySize: 1024 * 1024,
};

// Config consts here
const CFG_HTTP_KEEP_ALIVE_TIMEOUT = "HTTP_KEEP_ALIVE_TIMEOUT";
const CFG_HTTP_HEADER_TIMEOUT = "HTTP_HEADER_TIMEOUT";

const CFG_HTTP_NETWORK_INTERFACE = "HTTP_NETWORK_INTERFACE";
const CFG_HTTP_NETWORK_PORT = "HTTP_NETWORK_PORT";

const CFG_HTTP_HEALTHCHECK_PATH = "HTTP_HEALTHCHECK_PATH";
const CFG_HTTP_HEALTHCHECK_GOOD_RES = "HTTP_HEALTHCHECK_GOOD_RES";
const CFG_HTTP_HEALTHCHECK_BAD_RES = "HTTP_HEALTHCHECK_BAD_RES";

const CFG_HTTP_ENABLE_HTTPS = "HTTP_ENABLE_HTTPS";
const CFG_HTTP_KEY_FILE = "HTTP_KEY_FILE";
const CFG_HTTP_CERT_FILE = "HTTP_CERT_FILE";

const HTTP_MAN_TAG = "HttpMan";

// Default configs here
const DEFAULT_HTTP_CONFIG = {
  keepAliveTimeout: 65000,
  headerTimeout: 66000,

  networkInterface: "lo",
  networkPort: 8080,

  healthcheckPath: "/healthcheck",
  healthcheckGoodRes: 200,
  healthcheckBadRes: 503,

  enableHttps: false,
};

// HttpMan class here
export class HttpMan {
  private _sh: AppSh;
  private _logger: Logger;

  private _middlewareList: Middleware[];
  private _healthcheckCallbacks: HealthcheckCallback[];
  private _methodListMap: { [key: string]: MethodListElement[] };

  private _httpKeepAliveTimeout: number;
  private _httpHeaderTimeout: number;

  private _networkInterface: string;
  private _networkPort: number;
  private _enableHttps: boolean;

  private _healthCheckPath: string;
  private _healthCheckGoodResCode: number;
  private _healthCheckBadResCode: number;

  private _server?: http.Server;
  private _ip?: string;

  constructor(httpConfig: HttpConfig) {
    let config = {
      ...DEFAULT_HTTP_CONFIG,
      ...httpConfig,
    };

    this._sh = config.appSh;
    this._logger = config.appSh.logger;
    this._enableHttps = config.enableHttps;

    this._logger.startup(HTTP_MAN_TAG, "Initialising HTTP manager ...");

    this._middlewareList = [];
    this._healthcheckCallbacks = [];
    this._methodListMap = {};

    this._httpKeepAliveTimeout = this._sh.getConfigNum(
      CFG_HTTP_KEEP_ALIVE_TIMEOUT,
      config.keepAliveTimeout,
    );

    this._httpHeaderTimeout = this._sh.getConfigNum(
      CFG_HTTP_HEADER_TIMEOUT,
      config.headerTimeout,
    );

    this._networkInterface = this._sh.getConfigStr(
      CFG_HTTP_NETWORK_INTERFACE,
      config.networkInterface,
    );

    this._networkPort = this._sh.getConfigNum(
      CFG_HTTP_NETWORK_PORT,
      config.networkPort,
    );

    this._healthCheckPath = this._sh.getConfigStr(
      CFG_HTTP_HEALTHCHECK_PATH,
      config.healthcheckPath,
    );

    this._healthCheckGoodResCode = this._sh.getConfigNum(
      CFG_HTTP_HEALTHCHECK_GOOD_RES,
      config.healthcheckGoodRes,
    );

    this._healthCheckBadResCode = this._sh.getConfigNum(
      CFG_HTTP_HEALTHCHECK_BAD_RES,
      config.healthcheckBadRes,
    );

    this._enableHttps = this._sh.getConfigBool(
      CFG_HTTP_ENABLE_HTTPS,
      config.enableHttps,
    );

    this.setupHttpServer();

    this._logger.startup(HTTP_MAN_TAG, "Now listening. HTTP manager started!");
  }

  // Private methods here
  private setupHttpServer(): void {
    this._logger.startup(
      HTTP_MAN_TAG,
      `Finding IP for interface (${this._networkInterface})`,
    );

    let ifaces = os.networkInterfaces();
    this._logger.startup(HTTP_MAN_TAG, "Interfaces on host: %j", ifaces);

    if (ifaces[this._networkInterface] === undefined) {
      throw new Error(
        `${this._networkInterface} is not an interface on this server`,
      );
    }

    this._ip = "";

    // Search for the first I/F with a family of type IPv4
    let found = ifaces[this._networkInterface]?.find(
      (i) => i.family === "IPv4",
    );
    if (found !== undefined) {
      this._ip = found.address;
      this._logger.startup(
        HTTP_MAN_TAG,
        `Found IP (${this._ip}) for interface ${this._networkInterface}`,
      );
      this._logger.startup(
        HTTP_MAN_TAG,
        `Will listen on interface ${this._networkInterface} (IP: ${this._ip})`,
      );
    }

    if (this._ip.length === 0) {
      throw new Error(
        `${this._networkInterface} is not an interface on this server`,
      );
    }

    // Create either a HTTP or HTTPS server
    if (this._enableHttps) {
      let keyfile = this._sh.getConfigStr(CFG_HTTP_KEY_FILE);
      let certFile = this._sh.getConfigStr(CFG_HTTP_CERT_FILE);

      const options = {
        key: fs.readFileSync(keyfile),
        cert: fs.readFileSync(certFile),
      };

      this._logger.startup(
        HTTP_MAN_TAG,
        `Attempting to listen on (https://${this._ip}:${this._networkPort})`,
      );

      this._server = https
        .createServer(options, (req, res) =>
          this.handleHttpReq(req, res, "https"),
        )
        .listen(this._networkPort, this._ip);
    } else {
      this._logger.startup(
        HTTP_MAN_TAG,
        `Attempting to listen on (http://${this._ip}:${this._networkPort})`,
      );

      this._server = http
        .createServer((req, res) => this.handleHttpReq(req, res, "http"))
        .listen(this._networkPort, this._ip);
    }

    this._server.keepAliveTimeout = this._httpKeepAliveTimeout;
    this._server.headersTimeout = this._httpHeaderTimeout;

    // Now we need to add an endpoint for healthchecks
    this.addEndpoint("GET", this._healthCheckPath, (req, res, details) =>
      this.healthcheckCallback(req, res, details),
    );
  }

  private async handleHttpReq(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    protocol: "http" | "https",
  ): Promise<void> {
    // First, make sure we have callbacks for req method
    let method = <Method>req.method;
    let list = this._methodListMap[method];

    if (list === undefined) {
      res.statusCode = 404;
      res.end();
      return;
    }

    // Next see if we have a registered callback for the HTTP req path
    let found = false;
    let url = new URL(<string>req.url, `${protocol}://${req.headers.host}`);

    for (let el of list) {
      let result = el.matchFunc(url.pathname);

      // If result is false that means we found nothing
      if (result === false) {
        continue;
      }

      // If we are here we found a callback - process it and stop looking
      let details: EndpointCallbackDetails = { url, params: result.params };
      await this.processHttpReq(req, res, method, el, details);

      found = true;
      break;
    }

    // If found is still false then we know there is no registered callback
    if (found === false) {
      res.statusCode = 404;
      res.end();
    }
  }

  private async processHttpReq(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    method: Method,
    el: MethodListElement,
    details: EndpointCallbackDetails,
  ) {
    // If the req method is POST. PUT or PATCH we need to get the body
    if (method === "POST" || method === "PUT" || method === "PATCH") {
      // Store each data "chunk" we receive this array
      let chunks: Buffer[] = [];

      // This event fires when there is a chunk of the body received
      req.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });

      // This event fires when we have received all of the body
      req.on("end", async () => {
        details.body = Buffer.concat(chunks);

        let bodyOk = true;

        details.jsonBody = await this.checkForJsonBody(req, el, details).catch(
          (e) => {
            // Flag there was an error
            res.statusCode = 400;
            res.write(e.toString());
            res.end();

            bodyOk = false;
          },
        );

        if (bodyOk) {
          await this.callMiddleware(
            req,
            res,
            details,
            this._middlewareList,
            el.callback,
          );
        }
      });
    } else {
      await this.callMiddleware(
        req,
        res,
        details,
        this._middlewareList,
        el.callback,
      );
    }
  }

  private async checkForJsonBody(
    req: http.IncomingMessage,
    el: MethodListElement,
    details: EndpointCallbackDetails,
  ): Promise<unknown> {
    // Before we do anything make sure there is a body!
    if (details.body === undefined || details.body.length === 0) {
      // If there is no body and there is an input validator
      if (el.options.zodInputValidator !== undefined) {
        // Run the validator and let it complain to the user
        let data = el.options.zodInputValidator.safeParse(undefined);

        if (data.success === false) {
          // Set the error message you want to return
          let errMessage = data.error.toString();
          throw new Error(errMessage);
        }
      }
      return undefined;
    }

    let jsonBody: any;
    let parseOk = true;
    let errMessage = "";

    // Now check the content-type header to find out what sort of data we have
    const contentTypeHeader = req.headers["content-type"];

    if (contentTypeHeader !== undefined) {
      let contentType = contentTypeHeader.split(";")[0];

      switch (contentType) {
        case "application/json":
          try {
            jsonBody = JSON.parse(details.body.toString());
          } catch (_) {
            this._logger.error(
              HTTP_MAN_TAG,
              "Encountered an error when parsing the body of (%s) request on path (%s) - (%s)",
              req.method,
              details.url.toString(),
              details.body,
            );

            // Set the error message you want to return
            errMessage = "Can not parse JSON body!";

            parseOk = false;
          }
          break;
        case "application/x-www-form-urlencoded":
          let qry = new URLSearchParams(details.body.toString());
          jsonBody = {};

          for (let [key, value] of qry.entries()) {
            jsonBody[key] = value;
          }
          break;
        default:
          break;
      }
    }

    if (jsonBody !== undefined && el.options.zodInputValidator !== undefined) {
      let data = el.options.zodInputValidator.safeParse(jsonBody);

      if (data.success === false) {
        // Set the error message you want to return
        errMessage = data.error.toString();
        parseOk = false;
      }
    }

    // If the parsing fails then
    if (parseOk === false) {
      throw new Error(errMessage);
    }

    return jsonBody;
  }

  private async callMiddleware(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    details: EndpointCallbackDetails,
    middlewareStack: Middleware[],
    callback: EndpointCallback,
  ): Promise<void> {
    // If there is a middleware to call ...
    if (middlewareStack.length) {
      // ... then call it and pass the middlewares AFTER this in the next()
      await middlewareStack[0](req, res, details, async () => {
        await this.callMiddleware(
          req,
          res,
          details,
          middlewareStack.slice(1),
          callback,
        );
      });
    } else {
      // No more (or was there any??) middleware to call so call callback
      await callback(req, res, details);
    }
  }

  private async healthcheckCallback(
    _1: http.IncomingMessage,
    res: http.ServerResponse,
    _2: EndpointCallbackDetails,
  ): Promise<void> {
    let healthy = true;

    for (let cb of this._healthcheckCallbacks) {
      healthy = await cb();

      if (healthy === false) {
        break;
      }
    }

    if (healthy) {
      res.statusCode = this._healthCheckGoodResCode;
    } else {
      res.statusCode = this._healthCheckBadResCode;
    }

    res.end();
  }

  // Public methods here
  async stop(): Promise<void> {
    if (this._server !== undefined) {
      this._logger.shutdown(HTTP_MAN_TAG, "Closing HTTP manager port now ...");
      this._server.close();
      this._logger.shutdown(HTTP_MAN_TAG, "Port closed");
    }

    return;
  }

  addMiddleware(middleware: Middleware): void {
    this._middlewareList.push(middleware);
  }

  addHealthcheck(callback: HealthcheckCallback) {
    this._healthcheckCallbacks.push(callback);
  }

  addEndpoint(
    method: Method,
    path: string,
    callback: EndpointCallback,
    endpointOptions: EndpointOptions = {},
  ) {
    let options = {
      ...DEFAULT_ENDPOINT_OPTIONS,
      ...endpointOptions,
    };

    // Make sure we have a list for the method first
    if (this._methodListMap[method] === undefined) {
      this._methodListMap[method] = [];
    }

    // Then create the matching function
    let matchFunc = match(path, {
      decode: decodeURIComponent,
      strict: true,
    });

    this._logger.info(
      HTTP_MAN_TAG,
      "Adding %s endpoint for path (%s)",
      method.toUpperCase(),
      path,
    );

    // Finally add it to the list of callbacks
    this._methodListMap[method].push({ matchFunc, callback, options });
  }
}
