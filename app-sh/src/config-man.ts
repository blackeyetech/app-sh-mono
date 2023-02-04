// imports here
import { Logger } from "./logger.js";

import dotenv from "dotenv";

// Config consts here
const CFG_DOTENV_PATH = "DOTENV_PATH";

// enums here
export enum ConfigTypes {
  String,
  Boolean,
  Number,
}

// Types here
export type ConfigManOptions = {
  config: string;
  type: ConfigTypes;
  logTag: string;

  defaultVal?: string | boolean | number;
  cmdLineFlag?: string;
  silent?: boolean;
  redact?: boolean;
};

// Default configs here
const DEFAULT_CONFIG_OPTIONS = {
  silent: false,
  redact: false,
};

// ConfigMan class here
export class ConfigMan {
  // Properties here
  private _logger: Logger;

  // Constructor here
  constructor(logger: Logger) {
    this._logger = logger;

    // Check if the user has specified a .env path
    let dotenvPath = <string>this.get({
      config: CFG_DOTENV_PATH,
      type: ConfigTypes.String,
      logTag: "ConfigMan",
      defaultVal: "",
    });

    // If there is a .env path ...
    if (dotenvPath.length) {
      // .. then pass it to dotenv
      // NOTE: By default dotenv will NOT overwrite a set env var
      dotenv.config({ path: dotenvPath });
    }
  }

  // Private methods here
  private convertConfigValue(
    value: string,
    type: ConfigTypes,
  ): number | string | boolean {
    switch (type) {
      case ConfigTypes.Number:
        return parseInt(value);
      case ConfigTypes.Boolean:
        // Only accept y/Y to mean true
        if (value.toUpperCase() === "Y") {
          return true;
        }
        return false;
      default:
        // All that is left is String and this is already a string!
        return value;
    }
  }

  private checkCli(options: ConfigManOptions): undefined | string {
    // Ignore the first 2 params (node bin and executable file)
    let cliParams = process.argv.slice(2);

    // The convention used for config params on the command line is:
    // Convert to lowercase, replace '_' with '-' and prepend "--"
    let cliParam = `--${options.config.toLowerCase().replaceAll("_", "-")}`;

    // Command line flags are just prepended use a '-'
    let cmdLineFlag =
      options.cmdLineFlag !== undefined ? `-${options.cmdLineFlag}` : "";

    // If the param/flag is assigned a value on the cli it has the format:
    //   --param=value or -flag=value
    // If the flag is present but has not been assigned a value this
    // implies it is true, i.e "Y"
    let regExp: RegExp;

    if (options.cmdLineFlag === undefined) {
      // No flag specified so only look for the param and an assigned value
      regExp = new RegExp(`^${cliParam}=(.+)$`);
    } else {
      // Look for param and an assigned value or cmd line flag and an assigned
      // value or cmd line flag and no assigned value
      regExp = new RegExp(
        `^${cliParam}=(.+)$|^${cmdLineFlag}=(.+)$|^${cmdLineFlag}$`,
      );
    }

    // Step through each cli params until you find a match
    for (let i = 0; i < cliParams.length; i++) {
      let match = cliParams[i].match(regExp);

      let strValue: string;
      let paramOrFlag: string;

      // Continue if there was no match
      if (match === null) {
        continue;
      }

      // if a value was supplied it will either be match[1] => parm OR
      // match[2] => cmd line flag
      if (match[1] !== undefined) {
        // This means we found the param
        strValue = match[1];
        paramOrFlag = cliParam;
      } else if (match.length > 2 && match[2] !== undefined) {
        // This means we found the flag and it was asssigned a value
        strValue = match[2];
        paramOrFlag = cmdLineFlag;
      } else {
        // This means we found the flag and it was not assigned a value
        strValue = "Y";
        paramOrFlag = cmdLineFlag;
      }

      // We found it, now lets check if we can or should log that we found it
      // NOTE: If we log it we want to indicate is was found on the CLI
      if (this._logger.started && !options.silent) {
        this._logger.startup(
          <string>options.logTag,
          "CLI parameter/flag (%s) = (%j)",
          paramOrFlag,
          options.redact ? "redacted" : strValue,
        );
      }

      return strValue;
    }

    // If we are here then we found diddly squat!
    return;
  }

  // Public methods here
  get(configOptions: ConfigManOptions): string | number | boolean {
    // Setup the defaults
    let options: ConfigManOptions = {
      ...DEFAULT_CONFIG_OPTIONS,
      ...configOptions,
    };

    // Check the CLI first, i.e. CLI has higher precedence then env vars
    let strValue = this.checkCli(options);

    if (strValue === undefined) {
      // OK it's not in the CLI so lets check the env vars
      // NOTE: Always convert to upper case for env vars
      let evar = options.config.toUpperCase();
      strValue = process.env[evar];

      if (strValue !== undefined) {
        // We found it, now lets check if we can or should log that we found it
        // NOTE: If we log it we want to indicate is was found in an env var
        if (this._logger.started && !options.silent) {
          this._logger.startup(
            <string>options.logTag,
            "Env var (%s) = (%j)",
            evar,
            options.redact ? "redacted" : strValue,
          );
        }
      }
    }

    let value: string | number | boolean;

    // If the value was not found in the env vars then use default provided
    // NOTE: The default SHOULd have the correct type so do not do a conversion
    if (strValue === undefined) {
      // If the default was not provided then the config WAS required
      if (options.defaultVal === undefined) {
        // In this scenario we need to throw an error
        throw Error(
          `Config parameter (${options.config}) not set on the CLI or as an env var!`,
        );
      }

      // Otherwise use the default value
      value = options.defaultVal;

      // We found it, now lets check if we can or should log that we found it
      // NOTE: If we log it we want to indicate is the default value
      if (this._logger.started && !options.silent) {
        this._logger.startup(
          <string>options.logTag,
          "Default value used for (%s) = (%j)",
          options.config,
          options.redact ? "redacted" : value,
        );
      }
    } else {
      // If we are here we still need to convert the string value
      value = this.convertConfigValue(strValue, options.type);
    }

    return value;
  }
}
