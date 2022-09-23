/* ©️ 2016 - present FlowCrypt a.s. Limitations apply. Contact human@flowcrypt.com */

'use strict';

import { Api, ReqMethod } from './../shared/api.js';
import { Dict, Str } from '../../core/common.js';
import { PubkeysSearchResult } from './../pub-lookup.js';
import { AjaxErr, ApiErr } from '../shared/api-error.js';
import { ClientConfiguration } from "../../client-configuration";
import { ATTESTER_API_HOST } from '../../core/const.js';
import { MsgBlockParser } from '../../core/msg-block-parser.js';

type PubCallRes = { responseText: string, getResponseHeader: (n: string) => string | null };

export class Attester extends Api {

  constructor(
    private clientConfiguration: ClientConfiguration
  ) {
    super();
  }

  public lookupEmail = async (email: string): Promise<PubkeysSearchResult> => {
    if (!this.clientConfiguration.canLookupThisRecipientOnAttester(email)) {
      console.info(`Skipping attester lookup of ${email} because attester search on this domain is disabled.`);
      return { pubkeys: [] };
    }
    const results = await Promise.allSettled([
      this.doLookupLdap(email),  // get from recipient-specific LDAP server, if any, relayed through flowcrypt.com
      this.doLookup(email),  // get from flowcrypt.com public keyserver database
      this.doLookupLdap(email, 'keyserver.pgp.com'), // get from keyserver.pgp.com, relayed through flowcrypt.com
    ]);
    const validResults = results.filter(result => result.status === 'fulfilled');
    for (const result of validResults) {
      const fulfilResult = result as PromiseFulfilledResult<PubkeysSearchResult>;
      if (fulfilResult.value.pubkeys.length) {
        return fulfilResult.value;
      }
    }
    if (results[1].status === 'rejected') {
      throw results[1].reason as unknown;
    }
    return { pubkeys: [] };
  };

  public doLookupLdap = async (email: string, server?: string): Promise<PubkeysSearchResult> => {
    const ldapServer = server ?? `keys.${Str.getDomainFromEmailAddress(email)}`;
    try {
      const r = await this.pubCall(`ldap-relay?server=${ldapServer}&search=${email}`);
      return await this.getPubKeysSearchResult(r);
    } catch (e) {
      // treat error 500 as error 404 on this particular endpoint
      // https://github.com/FlowCrypt/flowcrypt-browser/pull/4627#issuecomment-1222624065
      if (ApiErr.isNotFound(e) || (e as AjaxErr).status === 500) {
        return { pubkeys: [] };
      }
      throw e;
    }
  };

  public lookupEmails = async (emails: string[]): Promise<Dict<PubkeysSearchResult>> => {
    const results: Dict<PubkeysSearchResult> = {};
    await Promise.all(emails.map(async (email: string) => {
      results[email] = await this.lookupEmail(email);
    }));
    return results;
  };

  /**
   * Set or replace public key with idToken as an auth mechanism
   * Used during setup
   * Can only be used for primary email because idToken does not contain info about aliases
   */
  public submitPrimaryEmailPubkey = async (email: string, pubkey: string, idToken: string): Promise<void> => {
    if (!this.clientConfiguration.canSubmitPubToAttester()) {
      throw new Error('Cannot replace pubkey at attester because your organisation rules forbid it');
    }
    await this.pubCall(`pub/${email}`, 'POST', pubkey, { authorization: `Bearer ${idToken}` });
  };

  /**
   * Request to replace pubkey that will be verified by clicking email
   * Used when user manually chooses to replace key
   * Can also be used for aliases
   */
  public submitPubkeyWithConditionalEmailVerification = async (email: string, pubkey: string): Promise<string> => {
    if (!this.clientConfiguration.canSubmitPubToAttester()) {
      throw new Error('Cannot replace pubkey at attester because your organisation rules forbid it');
    }
    const r = await this.pubCall(`pub/${email}`, 'POST', pubkey);
    return r.responseText;
  };

  public welcomeMessage = async (email: string, pubkey: string, idToken: string | undefined): Promise<{ sent: boolean }> => {
    const headers = idToken ? { authorization: `Bearer ${idToken!}` } : undefined;
    return await this.jsonCall<{ sent: boolean }>('welcome-message', { email, pubkey }, 'POST', headers);
  };

  private jsonCall = async <RT>(path: string, values?: Dict<any>, method: ReqMethod = 'POST', hdrs?: Dict<string>): Promise<RT> => {
    return await Api.apiCall(ATTESTER_API_HOST, path, values, 'JSON', undefined, { 'api-version': '3', ...hdrs ?? {} }, 'json', method) as RT;
  };

  private pubCall = async (resource: string, method: ReqMethod = 'GET', data?: string | undefined, hdrs?: Dict<string>): Promise<PubCallRes> => {
    return await Api.apiCall(ATTESTER_API_HOST, resource, data, typeof data === 'string' ? 'TEXT' : undefined, undefined, hdrs, 'xhr', method);
  };

  private getPubKeysSearchResult = async (r: PubCallRes): Promise<PubkeysSearchResult> => {
    const { blocks } = MsgBlockParser.detectBlocks(r.responseText);
    const pubkeys = blocks.filter((block) => block.type === 'publicKey').map((block) => block.content.toString());
    return { pubkeys };
  };

  private doLookup = async (email: string): Promise<PubkeysSearchResult> => {
    try {
      const r = await this.pubCall(`pub/${email}`);
      return await this.getPubKeysSearchResult(r);
    } catch (e) {
      if (ApiErr.isNotFound(e)) {
        return { pubkeys: [] };
      }
      throw e;
    }
  };

}
