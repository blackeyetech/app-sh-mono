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
      enableHttpMan: true,
      logLevel: LogLevel.TRACE,
      logTimestampLocale: "en-us",
      logTimestampTz: "EET",
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

let httpMan = sh.httpMan;

// httpMan.healthcheck(() => {
//   sh.info("Helllo!!!");
//   return true;
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

sh.httpMan.endpoint(
  "POST",
  "/test/:id",
  (req, res, details) => {
    // res.setHeader("Access-Control-Allow-Origin", "*");

    // sh.info("q=%s", details.url.searchParams.get("q"));
    // sh.info("r=%s", details.url.searchParams.get("r"));
    // sh.info("id=%s", details.params.id);
    sh.info("body=%s", details.middlewareProps.body);
    sh.info("jsonBody=%s", details.middlewareProps.json);
    // sh.info("headers=%s", req.headers);

    if (details.params.id === "1") {
      throw new HttpError(400, "fool!");
    }

    res.statusCode = 200;
    res.end();
  },

  {
    middlewareList: [HttpMan.body(), HttpMan.json(), middleware1, middleware2],
    corsOptions: {
      enable: true,
      headersAllowed: "*",
      originsAllowed: ["https://test-cors.org"],
      credentialsAllowed: true,
    },
  },
);

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

httpMan.endpoint("GET", "/ping", pong, {
  sseEndpoint: { pingInterval: 10, pingEvent: "ev1" },
});

httpMan.endpoint("GET", "/", (req, res, details) => {
  console.log("/");
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.write("<html><p>Hello</p></html>");
  res.statusCode = 200;
  res.end();
});
