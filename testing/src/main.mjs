import { AppSh, LogLevel } from "app-sh";

let sh = new AppSh({
  name: "Test",
  log: { level: LogLevel.TRACE, timestampFormat: "" },
});
await sh.init();

sh.info("Hello world");

// let b = $.getConfigBool({ config: "XXX", defaultVal: true });
// $.info("Bool (%j)", b);
// let s = $.getConfigStr({ config: "XXX", defaultVal: "" });
// $.info("String (%j)", s);
let def = undefined;
let n = sh.getConfigBool("XXX", undefined, { cmdLineFlag: "x" });
sh.info("Number (%j)", n);

let res = await sh.httpReq("https://google.com", "/search");

sh.info("%j", res.body);
let answer = await sh.question("How you doing?");
sh.info("You are doing %s", answer);
