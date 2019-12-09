/* © 2016-2018 FlowCrypt Limited. Limitations apply. Contact human@flowcrypt.com */

'use strict';

import { GOOGLE_API_HOST, gmailBackupSearchQuery } from '../../../core/const.js';
import { EmailProviderApi, EmailProviderInterface, SendableMsg } from '../email_provider_api.js';
import { Google } from '../../google.js';
import { ProgressCb, RecipientType, AjaxErr, ChunkedCb, ProviderContactsResults } from '../../api.js';
import { Buf } from '../../../core/buf.js';
import { Mime } from '../../../core/mime.js';
import { Value, Str, Dict } from '../../../core/common.js';
import { Env } from '../../../browser/env.js';
import { BrowserMsg } from '../../../browser/browser-msg.js';
import { Catch } from '../../../platform/catch.js';
import { Att } from '../../../core/att.js';
import { Contact, Pgp, FormatError } from '../../../core/pgp.js';
import { Xss } from '../../../platform/xss.js';
import { Store } from '../../../platform/store.js';
import { GmailRes, GmailParser } from './gmail-parser.js';
import { GoogleAuth } from '../../google-auth.js';
import { AddrParserResult, BrowserWindow } from '../../../browser/browser-window.js';

export type GmailResponseFormat = 'raw' | 'full' | 'metadata';

export class Gmail extends EmailProviderApi implements EmailProviderInterface {

  private readonly GMAIL_USELESS_CONTACTS_FILTER = '-to:txt.voice.google.com -to:craigslist.org';
  private readonly GMAIL_SEARCH_QUERY_LENGTH_LIMIT = 1400;

  privatebuildSearchQueryOr(arr: string[], quoted: boolean = false) {
    if (quoted) {
      return '("' + arr.join('") OR ("') + '")';
    } else {
      return '(' + arr.join(') OR (') + ')';
    }
  }

  threadGet(threadId: string, format?: GmailResponseFormat, progressCb?: ProgressCb): Promise<GmailRes.GmailThread> {
    return Google.gmailCall(this.acctEmail, 'GET', `threads/${threadId}`, { format }, { download: progressCb });
  }

  threadList(labelId: string): Promise<GmailRes.GmailThreadList> {
    return Google.gmailCall(this.acctEmail, 'GET', `threads`, {
      labelIds: labelId !== 'ALL' ? labelId : undefined,
      includeSpamTrash: Boolean(labelId === 'SPAM' || labelId === 'TRASH'),
      // pageToken: page_token,
      // q,
      // maxResults
    });
  }

  threadModify(id: string, rmLabels: string[], addLabels: string[]): Promise<GmailRes.GmailThread> {
    return Google.gmailCall(this.acctEmail, 'POST', `threads/${id}/modify`, {
      removeLabelIds: rmLabels || [], // todo - insufficient permission - need https://github.com/FlowCrypt/flowcrypt-browser/issues/1304
      addLabelIds: addLabels || [],
    });
  }

  draftCreate(mimeMsg: string, threadId: string): Promise<GmailRes.GmailDraftCreate> {
    return Google.gmailCall(this.acctEmail, 'POST', 'drafts', { message: { raw: Buf.fromUtfStr(mimeMsg).toBase64UrlStr(), threadId } });
  }

  draftDelete(id: string): Promise<GmailRes.GmailDraftDelete> {
    return Google.gmailCall(this.acctEmail, 'DELETE', 'drafts/' + id, undefined);
  }

  draftUpdate(id: string, mimeMsg: string): Promise<GmailRes.GmailDraftUpdate> {
    return Google.gmailCall(this.acctEmail, 'PUT', `drafts/${id}`, { message: { raw: Buf.fromUtfStr(mimeMsg).toBase64UrlStr() } });
  }

  draftGet(id: string, format: GmailResponseFormat = 'full'): Promise<GmailRes.GmailDraftGet> {
    return Google.gmailCall(this.acctEmail, 'GET', `drafts/${id}`, { format });
  }

  draftList(): Promise<GmailRes.GmailDraftList> {
    return Google.gmailCall(this.acctEmail, 'GET', 'drafts', undefined);
  }

  draftSend(id: string): Promise<GmailRes.GmailDraftSend> {
    return Google.gmailCall(this.acctEmail, 'POST', 'drafts/send', { id });
  }

  async msgSend(message: SendableMsg, progressCb?: ProgressCb): Promise<GmailRes.GmailMsgSend> {
    message.headers.From = message.from;
    for (const key of Object.keys(message.recipients)) {
      const sendingType = key as RecipientType;
      if (message.recipients[sendingType] && message.recipients[sendingType]!.length) {
        // todo - properly escape/encode this header using emailjs
        message.headers[sendingType[0].toUpperCase() + sendingType.slice(1)] = message.recipients[sendingType]!.map(h => h.replace(/[,]/g, '')).join(',');
      }
    }
    message.headers.Subject = message.subject;
    const mimeMsg = await Mime.encode(message.body, message.headers, message.atts, message.mimeRootType, message.sign);
    const request = Google.encodeAsMultipartRelated({ 'application/json; charset=UTF-8': JSON.stringify({ threadId: message.thread }), 'message/rfc822': mimeMsg });
    return Google.gmailCall(this.acctEmail, 'POST', 'messages/send', request.body, { upload: progressCb || Value.noop }, request.contentType);
  }

  msgList(q: string, includeDeleted: boolean = false, pageToken?: string): Promise<GmailRes.GmailMsgList> {
    return Google.gmailCall(this.acctEmail, 'GET', 'messages', { q, includeSpamTrash: includeDeleted, pageToken });
  }

  /**
   * Attempting to `msgGet format:raw` from within content scripts would likely fail if the mime message is 1MB or larger,
   * because strings over 1 MB may fail to get to/from bg page. A way to mitigate that would be to pass `R.GmailMsg$raw` prop
   * as a Buf instead of a string.
   */
  async msgGet(msgId: string, format: GmailResponseFormat, progressCb?: ProgressCb): Promise<GmailRes.GmailMsg> {
    return Google.gmailCall(this.acctEmail, 'GET', `messages/${msgId}`, { format: format || 'full' }, { download: progressCb });
  }

  msgsGet(msgIds: string[], format: GmailResponseFormat): Promise<GmailRes.GmailMsg[]> {
    return Promise.all(msgIds.map(id => this.msgGet(id, format)));
  }

  labelsGet(): Promise<GmailRes.GmailLabels> {
    return Google.gmailCall(this.acctEmail, 'GET', `labels`, {});
  }

  async attGet(msgId: string, attId: string, progressCb?: ProgressCb): Promise<GmailRes.GmailAtt> {
    type RawGmailAttRes = { attachmentId: string, size: number, data: string };
    const { attachmentId, size, data } = await Google.gmailCall(this.acctEmail, 'GET', `messages/${msgId}/attachments/${attId}`, {}, { download: progressCb }) as RawGmailAttRes;
    return { attachmentId, size, data: Buf.fromBase64UrlStr(data) }; // data should be a Buf for ease of passing to/from bg page
  }

  attGetChunk(msgId: string, attId: string): Promise<Buf> {
    return new Promise((resolve, reject) => {
      if (Env.isContentScript()) {
        // content script CORS not allowed anymore, have to drag it through background page
        // https://www.chromestatus.com/feature/5629709824032768
        BrowserMsg.send.bg.await.ajaxGmailAttGetChunk({ acctEmail: this.acctEmail, msgId, attId }).then(({ chunk }) => resolve(chunk)).catch(reject);
        return;
      }
      const stack = Catch.stackTrace();
      const minBytes = 1000;
      let processed = 0;
      const processChunkAndResolve = (chunk: string) => {
        if (!processed++) {
          // make json end guessing easier
          chunk = chunk.replace(/[\n\s\r]/g, '');
          // the response is a chunk of json that may not have ended. One of:
          // {"length":123,"data":"kks
          // {"length":123,"data":"kksdwei
          // {"length":123,"data":"kksdwei"
          // {"length":123,"data":"kksdwei"}
          if (chunk[chunk.length - 1] !== '"' && chunk[chunk.length - 2] !== '"') {
            chunk += '"}'; // json end
          } else if (chunk[chunk.length - 1] !== '}') {
            chunk += '}'; // json end
          }
          let parsedJsonDataField;
          try {
            parsedJsonDataField = JSON.parse(chunk).data; // tslint:disable-line:no-unsafe-any
          } catch (e) {
            console.info(e);
            reject(new Error("Chunk response could not be parsed"));
            return;
          }
          for (let i = 0; parsedJsonDataField && i < 50; i++) {
            try {
              resolve(Buf.fromBase64UrlStr(parsedJsonDataField)); // tslint:disable-line:no-unsafe-any
              return;
            } catch (e) {
              // the chunk of data may have been cut at an inconvenient index
              // shave off up to 50 trailing characters until it can be decoded
              parsedJsonDataField = parsedJsonDataField.slice(0, -1); // tslint:disable-line:no-unsafe-any
            }
          }
          reject(new Error("Chunk response could not be decoded"));
        }
      };
      GoogleAuth.googleApiAuthHeader(this.acctEmail).then(authToken => {
        const r = new XMLHttpRequest();
        const method = 'GET';
        const url = `${GOOGLE_API_HOST}/gmail/v1/users/me/messages/${msgId}/attachments/${attId}`;
        r.open(method, url, true);
        r.setRequestHeader('Authorization', authToken);
        r.send();
        let status: number;
        const responsePollInterval = Catch.setHandledInterval(() => {
          if (status >= 200 && status <= 299 && r.responseText.length >= minBytes) {
            window.clearInterval(responsePollInterval);
            processChunkAndResolve(r.responseText);
            r.abort();
          }
        }, 10);
        r.onreadystatechange = () => {
          if (r.readyState === 2 || r.readyState === 3) { // headers, loading
            status = r.status;
            if (status >= 300) {
              reject(AjaxErr.fromXhr({ status, readyState: r.readyState }, { method, url }, stack));
              window.clearInterval(responsePollInterval);
              r.abort();
            }
          }
          if (r.readyState === 3 || r.readyState === 4) { // loading, done
            if (status >= 200 && status <= 299 && r.responseText.length >= minBytes) { // done as a success - resolve in case response_poll didn't catch this yet
              processChunkAndResolve(r.responseText);
              window.clearInterval(responsePollInterval);
              if (r.readyState === 3) {
                r.abort();
              }
            } else { // done as a fail - reject
              reject(AjaxErr.fromXhr({ status, readyState: r.readyState }, { method, url }, stack));
              window.clearInterval(responsePollInterval);
            }
          }
        };
      }).catch(reject);
    });
  }

  async fetchAtts(atts: Att[], progressCb?: ProgressCb) {
    if (!atts.length) {
      return;
    }
    let lastProgressPercent = -1;
    const loadedAr: Array<number> = [];
    // 1.33 is a coefficient we need to multiply because total size we need to download is larger than all files together
    const total = atts.map(x => x.length).reduce((a, b) => a + b) * 1.33;
    const responses = await Promise.all(atts.map((a, index) => {
      return this.attGet(a.msgId!, a.id!, (_, loaded, s) => {
        if (progressCb) {
          loadedAr[index] = loaded || 0;
          const totalLoaded = loadedAr.reduce((a, b) => a + b);
          const progressPercent = Math.round((totalLoaded * 100) / total);
          if (progressPercent !== lastProgressPercent) {
            lastProgressPercent = progressPercent;
            progressCb(progressPercent, totalLoaded, total);
          }
        }
      });
    }));
    for (const i of responses.keys()) {
      atts[i].setData(responses[i].data);
    }
  }

  /**
  * This will keep triggering callback with new emails as they are being discovered
  */
  async guessContactsFromSentEmails(userQuery: string, knownContacts: Contact[], chunkedCb: ChunkedCb): Promise<void> {
    let gmailQuery = `is:sent ${this.GMAIL_USELESS_CONTACTS_FILTER} `;
    if (userQuery) {
      const variationsOfTo = userQuery.split(/[ .]/g).filter(v => !['com', 'org', 'net'].includes(v));
      if (!variationsOfTo.includes(userQuery)) {
        variationsOfTo.push(userQuery);
      }
      gmailQuery += '(';
      while (variationsOfTo.length) {
        gmailQuery += `to:${variationsOfTo.pop()}`;
        if (gmailQuery.length > this.GMAIL_SEARCH_QUERY_LENGTH_LIMIT) {
          break;
        }
        if (variationsOfTo.length > 1) {
          gmailQuery += ' OR ';
        }
      }
      gmailQuery += ')';
    }
    for (const contact of knownContacts.filter(c => Str.isEmailValid(c.email))) {
      if (gmailQuery.length > this.GMAIL_SEARCH_QUERY_LENGTH_LIMIT) {
        break;
      }
      gmailQuery += ` -to:${contact.email}`;
    }
    await this.apiGmailLoopThroughEmailsToCompileContacts(gmailQuery, chunkedCb);
  }

  /**
   * Extracts the encrypted message from gmail api. Sometimes it's sent as a text, sometimes html, sometimes attachments in various forms.
   */
  async extractArmoredBlock(msgId: string, format: GmailResponseFormat, progressCb?: ProgressCb): Promise<{ armored: string, subject?: string }> {
    const gmailMsg = await this.msgGet(msgId, format);
    const subject = gmailMsg.payload ? GmailParser.findHeader(gmailMsg.payload, 'subject') : undefined;
    if (format === 'full') {
      const bodies = GmailParser.findBodies(gmailMsg);
      const atts = GmailParser.findAtts(gmailMsg);
      const fromTextBody = Pgp.armor.clip(Buf.fromBase64UrlStr(bodies['text/plain'] || '').toUtfStr());
      if (fromTextBody) {
        return { armored: fromTextBody, subject };
      }
      const fromHtmlBody = Pgp.armor.clip(Xss.htmlSanitizeAndStripAllTags(Buf.fromBase64UrlStr(bodies['text/html'] || '').toUtfStr(), '\n'));
      if (fromHtmlBody) {
        return { armored: fromHtmlBody, subject };
      }
      if (atts.length) {
        for (const att of atts) {
          if (att.treatAs() === 'encryptedMsg') {
            await this.fetchAtts([att], progressCb);
            const armoredMsg = Pgp.armor.clip(att.getData().toUtfStr());
            if (!armoredMsg) {
              throw new FormatError('Problem extracting armored message', att.getData().toUtfStr());
            }
            return { armored: armoredMsg, subject };
          }
        }
        throw new FormatError('Armored message not found', JSON.stringify(gmailMsg.payload, undefined, 2));
      } else {
        throw new FormatError('No attachments', JSON.stringify(gmailMsg.payload, undefined, 2));
      }
    } else { // format === raw
      const mimeMsg = Buf.fromBase64UrlStr(gmailMsg.raw!);
      const decoded = await Mime.decode(mimeMsg);
      if (decoded.text !== undefined) {
        const armoredMsg = Pgp.armor.clip(decoded.text); // todo - the message might be in attachments
        if (armoredMsg) {
          return { armored: armoredMsg, subject };
        } else {
          throw new FormatError('Could not find armored message in parsed raw mime', mimeMsg.toUtfStr());
        }
      } else {
        throw new FormatError('No text in parsed raw mime', mimeMsg.toUtfStr());
      }
    }
  }

  async fetchAcctAliases(): Promise<GmailRes.GmailAliases> {
    return Google.gmailCall(this.acctEmail, 'GET', 'settings/sendAs', {});
  }

  async fetchMsgsHeadersBasedOnQuery(q: string, headerNames: string[], msgLimit: number) {
    const { messages } = await this.msgList(q, false);
    return await this.extractHeadersFromMsgs(messages || [], headerNames, msgLimit);
  }

  async fetchKeyBackups() {
    const res = await this.msgList(gmailBackupSearchQuery(this.acctEmail), true);
    if (!res.messages) {
      return [];
    }
    const msgIds = res.messages.map(m => m.id);
    const msgs = await this.msgsGet(msgIds, 'full');
    const atts: Att[] = [];
    for (const msg of msgs) {
      atts.push(...GmailParser.findAtts(msg));
    }
    await this.fetchAtts(atts);
    const { keys } = await Pgp.key.readMany(Buf.fromUtfStr(atts.map(a => a.getData().toUtfStr()).join('\n')));
    return keys;
  }

  private apiGmailBuildFilteredQuery(query: string, allRawEmails: string[]) {
    let filteredQuery = query;
    for (const rawEmail of allRawEmails) {
      filteredQuery += ` -to:"${rawEmail}"`;
      if (filteredQuery.length > this.GMAIL_SEARCH_QUERY_LENGTH_LIMIT) {
        return filteredQuery;
      }
    }
    return filteredQuery;
  }

  private async apiGmailGetNewUniqueRecipientsFromHeaders(toHeaders: string[], allResults: Contact[], allRawEmails: string[]): Promise<Contact[]> {
    if (!toHeaders.length) {
      return [];
    }
    const rawParsedResults: AddrParserResult[] = [];
    toHeaders = Value.arr.unique(toHeaders);
    for (const to of toHeaders) {
      rawParsedResults.push(...(window as unknown as BrowserWindow)['emailjs-addressparser'].parse(to));
    }
    for (const rawParsedRes of rawParsedResults) {
      if (rawParsedRes.address && allRawEmails.indexOf(rawParsedRes.address) === -1) {
        allRawEmails.push(rawParsedRes.address);
      }
    }
    const newValidResults = await Promise.all(rawParsedResults
      .filter(r => r.address && Str.isEmailValid(r.address))
      .map(({ address, name }) => Store.dbContactObj({ email: address!, name }))); // address! because we .filter based on r.address being truthy
    const uniqueNewValidResults: Contact[] = [];
    for (const newValidRes of newValidResults) {
      if (allResults.map(c => c.email).indexOf(newValidRes.email) === -1) {
        const foundIndex = uniqueNewValidResults.map(c => c.email).indexOf(newValidRes.email);
        if (foundIndex === -1) {
          uniqueNewValidResults.push(newValidRes);
        } else if (newValidRes.name && !uniqueNewValidResults[foundIndex].name) {
          uniqueNewValidResults[foundIndex].name = newValidRes.name; // prefer to also save name if first encountered result is missing it
        }
      }
    }
    return uniqueNewValidResults;
  }

  private async apiGmailLoopThroughEmailsToCompileContacts(query: string, chunkedCb: (r: ProviderContactsResults) => void) {
    const allResults: Contact[] = [];
    const allRawEmails: string[] = [];
    let lastFilteredQuery = '';
    let continueSearching = true;
    while (continueSearching) {
      const filteredQuery = this.apiGmailBuildFilteredQuery(query, allRawEmails);
      if (filteredQuery === lastFilteredQuery) {
        break;
      }
      if (filteredQuery.length > this.GMAIL_SEARCH_QUERY_LENGTH_LIMIT) {
        continueSearching = false;
      }
      const headers = await this.fetchMsgsHeadersBasedOnQuery(filteredQuery, ['to'], 50);
      lastFilteredQuery = filteredQuery;
      const uniqueNewValidResults = await this.apiGmailGetNewUniqueRecipientsFromHeaders(headers.to, allResults, allRawEmails);
      if (!uniqueNewValidResults.length) {
        break;
      }
      allResults.push(...uniqueNewValidResults);
      chunkedCb({ new: uniqueNewValidResults, all: allResults });
    }
    chunkedCb({ new: [], all: allResults });
  }

  private async extractHeadersFromMsgs(msgsIds: GmailRes.GmailMsgList$message[], headerNames: string[], msgLimit: number): Promise<Dict<string[]>> {
    const headerVals: Dict<string[]> = {};
    for (const headerName of headerNames) {
      headerVals[headerName] = [];
    }
    for (const msg of await this.msgsGet(msgsIds.slice(0, msgLimit).map(m => m.id), 'metadata')) {
      for (const headerName of headerNames) {
        const value = GmailParser.findHeader(msg, headerName);
        if (typeof value !== 'undefined') {
          headerVals[headerName].push(value);
        }
      }
    }
    return headerVals;
  }

}
