import { AppSh, LogLevel, HttpMan, HttpError } from "app-sh";

let sh = new AppSh({
  logLevel: LogLevel.TRACE,
  logTimestampFormat: "",
});

let httpMan = sh.httpMan;
if (httpMan === undefined) {
  throw Error("HttpMan not enabled");
}

sh.info("Hello world");

// let b = $.getConfigBool({ config: "XXX", defaultVal: true });
// $.info("Bool (%j)", b);
// let s = $.getConfigStr({ config: "XXX", defaultVal: "" });
// $.info("String (%j)", s);
let n = sh.getConfigNum("XXX", 123, { cmdLineFlag: "x" });
sh.info("Number (%j)", n);

httpMan.endpoint(
  "POST",
  "/test/:id",
  (req, res, details) => {
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

  [HttpMan.body(), HttpMan.json()],
);
