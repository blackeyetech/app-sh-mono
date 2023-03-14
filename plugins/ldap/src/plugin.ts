// imports here

import { AppSh, AppShPlugin } from "app-sh";

import ldap from "ldapjs";

// Types here

// Config consts here
export type LdapConfig = {
  appSh?: AppSh;

  adServer: string;
  userDnBase: string;
  serviceDn: string;
  servicePassword: string;
};

// Default configs here

// Ldap class here
export class Ldap extends AppShPlugin {
  private _adServer: string;
  private _userDnBase: string;
  private _serviceDn: string;
  private _servicePassword: string;

  private _usingLdaps: boolean;
  private _tryingToBindServiceAccount: boolean;
  private _serviceConnectionTimeout?: NodeJS.Timeout;
  private _serviceLdapClient?: ldap.Client;

  constructor(config: LdapConfig) {
    super({
      name: "ldap",
      appSh: config.appSh,
      // NOTE: PLUGIN_VERSION is replaced with package.json#version by a
      // rollup plugin at build time
      pluginVersion: "PLUGIN_VERSION",
    });

    this._adServer = config.adServer;
    this._userDnBase = config.userDnBase;
    this._serviceDn = config.serviceDn;
    this._servicePassword = config.servicePassword;

    // Check if we are using LDAPS.
    // NOTE: If not then we will use startTls when making any connection
    if (this._adServer.match(/^ldaps:/)) {
      this.info("Using LDAPS");
      this._usingLdaps = true;
    } else {
      this.info("Using LDAP with startTls()");
      this._usingLdaps = false;
    }

    this._tryingToBindServiceAccount = false;
  }

  // Protected methods here
  async stop(): Promise<void> {
    if (this._serviceConnectionTimeout !== undefined) {
      clearInterval(this._serviceConnectionTimeout);
    }

    if (this._serviceLdapClient !== undefined) {
      // Unbind the service account and shut down
      await this.ldapUnbind(this._serviceLdapClient, this._serviceDn);
      this._serviceLdapClient.destroy();
    }
  }

  // Private methods here
  private async bindServiceAccount(
    resolve?: (started: boolean) => void,
  ): Promise<void> {
    this._tryingToBindServiceAccount = true;

    // Try to bind the service account.
    let bound = await this.tryToBindServiceAccount();

    if (bound) {
      // Check if there is a resolve available to call!
      if (resolve !== undefined) {
        this._tryingToBindServiceAccount = false;
        resolve(true);
      }
    } else {
      this.error(
        "Failed to bind to service account. Will try again in 5 secs ...",
      );
      // If it fails then try again in 5 seconds
      setTimeout(() => {
        this.bindServiceAccount(resolve);
      }, 5000);
    }
  }

  private async tryToBindServiceAccount(): Promise<boolean> {
    this.info("BindServiceAccount: Trying to bind to the service account ...");

    // Attempt to Bind the service a/c
    this._serviceLdapClient = await this.ldapConnect(
      this._serviceDn,
      true,
    ).catch((e) => {
      this.error("BindServiceAccount: ldapConnect return an error (%s)", e);
      return undefined; // This is to stop a TS warning ...
    });

    if (this._serviceLdapClient === undefined) {
      this.error(
        "BindServiceAccount: Couldn't create a connection for the service account",
      );
      return false;
    }

    let bound = await this.ldapBind(
      this._serviceLdapClient,
      this._serviceDn,
      this._servicePassword,
    );

    if (bound === false) {
      this.error("Start: Couldn't create a bind for the service account");
      this._serviceLdapClient = undefined;
      return false;
    }

    this.info("BindServiceAccount: Bound to service account");

    // Set up an interval timer for i min to keep the service connction alive
    // Capture the interval timer so we can stop it later
    this._serviceConnectionTimeout = setInterval(() => {
      // Call this as a keep alive ...
      this.info("Executing keepalive for service connection.");
      this.ldapUserSearch("just.a.keepalive@service").catch(() => {});
    }, 60 * 1000);

    return true;
  }

  // Public methods here
  async start() {
    // Return a Promise so we can attempt multiple retries to bind service a/c
    return new Promise((resolve) => {
      this.bindServiceAccount(resolve);
    });
  }

  async userAuthenticate(
    user: string,
    password: string,
    userAttribute: string = "sAMAccountName",
  ): Promise<boolean> {
    let attribs = await this.ldapUserSearch(user, userAttribute).catch(
      () => {},
    );

    // If there are no attribs then the user does not have an account
    if (attribs === undefined) {
      this.warn("UserAuthenticate: No user found with mail (%s)", user);
      return false;
    }

    // We need a temp connection
    let client = await this.ldapConnect(user, false).catch(() => {});
    if (client === undefined) {
      return false;
    }

    // bind to temp connection as the user to test creds
    let userDn = <string>attribs.dn; // This will be there because we asked for it!
    let bound = await this.ldapBind(client, userDn, password).catch(() => {});

    // Tidy up before you do anything else
    await this.ldapUnbind(client, user);
    client.destroy();

    if (bound === true) {
      return true;
    }

    return false;
  }

  async ldapConnect(
    user: string,
    isServiceConnection: boolean = false,
  ): Promise<ldap.Client | undefined> {
    // Create the LDAP client first
    let client = ldap.createClient({
      url: [this._adServer],
    });

    // Since createClient returns an event emitter, return a Promise to handle it
    return new Promise((resolve, reject) => {
      // Setup handlers for events "error" and "connect"
      client.on("error", (err) => {
        this.error(
          "LDAPConnect: There was and error creating the LDAP client for (%s): (%s)",
          user,
          err,
        );
        reject();
      });

      client.on("connect", async () => {
        this.debug("LDAPConnect: Connected");

        // Start TLS - can only do this if we are not using LDAPS
        if (this._usingLdaps === false) {
          let started = await this.startTls(client);
          if (started === false) {
            client.destroy();
            reject();
          }
        }

        resolve(client);
      });

      // Set up some basic logging for each of the events
      let events = [
        "connectRefused",
        "connectTimeout",
        "connectError",
        "setupError",
        "socketTimeout",
        "resultError",
        "timeout",
        "destroy",
        "end",
        "close",
        "idle",
      ];

      let reconnectEvents = [
        "close",
        "connectError",
        "connectRefused",
        "connectTimeout",
      ];

      for (let event of events) {
        client.on(event, async (e) => {
          if (
            isServiceConnection &&
            reconnectEvents.includes(event) &&
            this._tryingToBindServiceAccount === false // Try and bind on the first event in the list
          ) {
            // If the connection closes we need to clear the existing interval timer
            // and create a new bind
            clearInterval(this._serviceConnectionTimeout);
            this._serviceLdapClient?.destroy();
            this.bindServiceAccount();
          }
          this.debug(
            "LDAPConnect: Event (%s) generated for user (%s): (%s)",
            event,
            user,
            e,
          );
        });
      }
    });
  }

  async ldapBind(
    client: ldap.Client,
    userDn: string,
    password: string,
  ): Promise<boolean> {
    // Since bind requires a callback return a Promise to handle it
    return new Promise((resolve) => {
      client.bind(userDn, password, (e) => {
        if (e) {
          this.error(
            "LDAPBind: There was and error binding the LDAP user (%s): (%s)",
            userDn,
            e,
          );

          // [InvalidCredentialsError]: 80090308: LdapErr: DSID-0C090439, comment: AcceptSecurityContext error, data 52e, v4563

          if (e instanceof ldap.InvalidCredentialsError) {
            this.warn(
              "LDAPBind: User with DN (%s) entered invalid password!",
              userDn,
            );
          }
          resolve(false);
        } else {
          this.debug("LDAPBind: User (%s) is bound!", userDn);
          resolve(true);
        }
      });
    });
  }

  async ldapUnbind(client: ldap.Client, userCn: string): Promise<void> {
    // Since unbind requires a callback return a Promise to handle it
    return new Promise((resolve) => {
      client.unbind(() => {
        this.debug("LDAPUnbind: User (%s) is unbound!", userCn);
        resolve();
      });
    });
  }

  async startTls(client: ldap.Client): Promise<boolean> {
    const opts = {
      rejectUnauthorized: false,
    };

    // Since starttls requires a callback return a Promise to handle it
    return new Promise((resolve) => {
      client.starttls(opts, null, (e) => {
        if (e !== null) {
          this.error("Start TLS generated an error (%s)", e);
          resolve(false);
        } else {
          this.info("LDAP TLS is started!");
          resolve(true);
        }
      });
    });
  }

  async ldapUserSearch(
    user: string,
    userAttribute: string = "sAMAccountName",
  ): Promise<Record<string, string | number>> {
    // Atributes to get back from LDAP search - always get "dn"
    let attributes = ["dn"];

    // We will always be searching by the users email
    const opts: ldap.SearchOptions = {
      filter: `(${userAttribute}=${user})`, // Search for the user
      scope: "sub", // Search the sub directories from the base
      attributes,
    };

    return new Promise((resolve, reject) => {
      // Since search requires a callback return a Promise to handle it
      this._serviceLdapClient?.search(this._userDnBase, opts, (e, res) => {
        if (e) {
          this.error(
            "LDAPUserSearch: There was and error searching for mail (%s): (%s)",
            user,
            e,
          );
          reject();
        }

        let results: Record<string, string | number> = {};

        // Setup handlers for events "searchEntry", "error" and "end"
        res.on("searchEntry", (entry) => {
          // Don't resolve yet, the "end" event will be called last
          for (let attrib of attributes) {
            results[attrib] = <string>entry.object[attrib];
          }
          this.debug(
            "LDAPUserSearch: Attribs for (%s) are (%s)",
            user,
            results,
          );
        });

        res.on("error", (e) => {
          // Don't reject  yet, the "end" event will be called last
          this.error(
            "LDAPUserSearch: There was and error searching for mail (%s): (%s)",
            user,
            e.message,
          );
        });

        res.on("end", () => {
          // If cn was not found then the user does not exist - so reject
          if (results.dn === undefined) {
            reject();
          }

          // Otherwise we found them!!
          resolve(results);
        });
      });
    });
  }
}
