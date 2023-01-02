import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import replace from "@rollup/plugin-replace";
import terser from "@rollup/plugin-terser";

import { readFileSync } from "fs";

const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
);

const NODE_ENV =
  process.env.NODE_ENV === undefined ? "development" : process.env.NODE_ENV;

let plugins = [
  replace({
    preventAssignment: true,
    values: { APP_SH_VERSION: pkg.version },
  }),
  commonjs(),
  resolve({ preferBuiltins: true }),
  json(),
];

if (NODE_ENV !== "development") {
  plugins.push(terser());
}

export default [
  {
    input: "dist/plugin.js",
    output: {
      file: "dist/plugin.mjs",
      format: "es",
    },

    plugins,
  },
  {
    input: "dist/plugin.js",
    output: {
      file: "dist/plugin.cjs",
      format: "cjs",
    },

    plugins,
  },
];
