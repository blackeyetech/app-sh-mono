import { Shell, LogLevel } from "app-sh";

let sh = new Shell({
  name: "Test",
  log: { level: LogLevel.TRACE, timestampFormat: "" },
});
await sh.init();

sh.info("Hello world");

// let b = $.getConfigBool({ config: "XXX", defaultVal: true });
// $.info("Bool (%j)", b);
// let s = $.getConfigStr({ config: "XXX", defaultVal: "" });
// $.info("String (%j)", s);
let n = sh.getConfigNum("XXX", 123);
sh.info("Number (%j)", n);
