import {
  AppSh,
  LogLevel,
  HttpMan,
  HttpError,
  HttpReqAborted,
  HttpReqError,
} from "app-sh";

import * as http from "node:http";
import { z } from "zod";

// process.on("uncaughtException", (e) => {
//   sh.error("caught %s)", e);
//   // sh.exit(1);
// });

class App extends AppSh {
  constructor() {
    super({
      // logLevel: LogLevel.TRACE,
      logTimestampLocale: "en-us",
      logTimestampTz: "UTC",
      logTimestamp: true,
      catchExceptions: true,
      exitOnUnhandledExceptions: false,
    });
  }

  async stop() {
    this.shutdown("Bye 1!");
  }
}

let sh = new App();

sh.finally(async () => {
  sh.shutdown("Bye 2!");
});

sh.info("Hello world");

// let b = $.getConfigBool({ config: "XXX", defaultVal: true });
// $.info("Bool (%j)", b);
// let s = $.getConfigStr({ config: "XXX", defaultVal: "" });
// $.info("String (%j)", s);
let def = undefined;
let n = sh.getConfigNum("XXX", 1, { cmdLineFlag: "x" });
sh.info("XXX (%j)", n);

// let i = c / 0;

let res = await sh
  .httpReq("https://httpbin.org", "/bearer", {
    method: "GET",
    // timeout: 3,
  })
  .catch((e) => {
    if (e instanceof HttpReqAborted) {
      sh.info(e.message);
    } else if (e instanceof HttpReqError) {
      sh.error("%s: %s", e.status, e.message);
    }
  });

sh.info("%j", res);

// for (let header of res.headers.entries()) {
//   sh.info("Header: %s: %s", header[0], header[1]);
// }

// let answer = await sh.question("Hit return to continue?");
// sh.info("You are doing %s", answer);

// sh.shutdownError();

sh.trace("Traced!");

let httpMan1 = sh.addHttpMan("lo", 8080, {
  loggerTag: "HttpMan1",
  defaultMiddlewareList: [HttpMan.body(), HttpMan.json()],
});

let httpMan2 = sh.addHttpMan("lo", 8081, {
  loggerTag: "HttpMan2",
  defaultMiddlewareList: [HttpMan.body(), HttpMan.json()],
});
// httpMan.healthcheck(() => {
//   sh.info("Helllo!!!");
//   return false;
// });
// // sh.sleep(2);

let middleware1 = async (req, res, details, next) => {
  let now = new Date().valueOf();
  sh.info("in the middle of one");
  // details.body = Buffer.from("howdy");
  await next();
  let time = new Date().valueOf() - now;
  sh.info("finished the middle one - %s", time);
};

let middleware2 = async (req, res, details, next) => {
  sh.info("in the middle of two");
  await next();
  sh.info("finished the middle two");
};

// // sh.httpMan.addMiddleware(async (req, res, details, next) => {
// //   sh.info("in the middle of three");
// //   // await sh.sleep(5);
// //   await next();
// //   sh.info("finished the middle three");
// // });

const User = z.object({
  a: z.string(),
  b: z.string(),
});

httpMan1.endpoint(
  "POST",
  "/test/:id",
  (req, res, details) => {
    // // res.setHeader("Access-Control-Allow-Origin", "*");

    // // sh.info("q=%s", details.url.searchParams.get("q"));
    // // sh.info("r=%s", details.url.searchParams.get("r"));
    // // sh.info("id=%s", details.params.id);
    // sh.info("body=%s", details.middlewareProps.body);
    // sh.info("jsonBody=%s", details.middlewareProps.json);
    // // sh.info("headers=%s", req.headers);

    // if (details.params.id === "1") {
    //   throw new HttpError(400, "fool!");
    // }

    res.statusCode = 200;
    res.json = { hello: "kieran" };
  },

  {
    middlewareList: [middleware1, middleware2],
    corsOptions: {
      enable: true,
      headersAllowed: "*",
      originsAllowed: ["https://test-cors.org"],
      credentialsAllowed: true,
    },
  },
);

httpMan1.endpoint("GET", "/test/:id", (req, res, details) => {
  res.json = { hello: "kieran" };
  res.json = "hello";
});

let pong = (req, res, details) => {
  sh.info("pinged");
  for (let header in req.headers) {
    sh.info("Header: %s: %s", header, req.headers[header]);
  }

  // res.setHeader("Access-Control-Allow-Origin", "*");
  let i = 1;
  sh.info("last event id: %s", details.sseServer.lastEventId);

  res.addListener("close", () => {
    console.log("closed!");
  });
  setInterval(
    () => {
      i += 1;
      details.sseServer.sendData(i, { id: i });
    },
    1000,
    res,
    sh,
  );
};

httpMan1.endpoint("GET", "/ping", pong, {
  sseEndpoint: { pingInterval: 10, pingEventName: "ev1" },
});

httpMan1.endpoint("GET", "/", (req, res, details) => {
  res.html = "<html><p>Hello from 1</p></html>";
});

httpMan2.endpoint("GET", "/", (req, res, details) => {
  res.text = "<html><p>Hello from 2</p></html>";
});
