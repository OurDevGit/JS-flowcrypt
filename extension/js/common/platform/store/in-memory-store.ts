/* ©️ 2016 - present FlowCrypt a.s. Limitations apply. Contact human@flowcrypt.com */

import { AbstractStore } from './abstract-store.js';
import { BrowserMsg } from '../../browser/browser-msg.js';

/**
 * Temporary In-Memory store for sensitive values, expiring after clientConfiguration.in_memory_pass_phrase_session_length (or default 4 hours)
 * see background_page.ts for the other end, also ExpirationCache class
 */
export class InMemoryStore extends AbstractStore {

  public static set = async (acctEmail: string, key: string, value?: string, expiration?: number) => {
    return await BrowserMsg.send.bg.await.inMemoryStoreSet({ acctEmail, key, value, expiration });
  };

  public static get = async (acctEmail: string, key: string): Promise<string | undefined> => {
    return await BrowserMsg.send.bg.await.inMemoryStoreGet({ acctEmail, key }) ?? undefined;
  };

}
