/**
 * One client per account, built on demand and kept.
 *
 * Each account has its own refresh token and therefore its own access token
 * with its own expiry, so they cannot share a client. They do share a quota
 * tracker, because the daily cap is per Google Cloud project and two accounts
 * authorised through the same project draw on the same budget.
 */

import { PhotosClient } from "./client.js";
import { QuotaTracker } from "./quota.js";
import { selectAccount, type Config } from "../config.js";

export class ClientPool {
  private readonly config: Config;
  private readonly quota = new QuotaTracker();
  private readonly clients = new Map<string, PhotosClient>();

  constructor(config: Config) {
    this.config = config;
  }

  /** The client for the named account, or for the default one. */
  for(hint?: string): PhotosClient {
    const account = selectAccount(this.config, hint);
    let client = this.clients.get(account.name);
    if (!client) {
      client = new PhotosClient(account, this.config, this.quota);
      this.clients.set(account.name, client);
    }
    return client;
  }

  /** Every configured account, for the tools that report across all of them. */
  all(): PhotosClient[] {
    return this.config.accounts.map((a) => this.for(a.name));
  }
}
