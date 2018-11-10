/* © 2016-2018 FlowCrypt Limited. Limitations apply. Contact human@flowcrypt.com */

'use strict';

import { Store, GlobalStore, Serializable, AccountStore, Contact } from './store.js';
import { Value, Str, Dict, StandardError } from './common.js';
import { Pgp, FormatError } from './pgp.js';
import { FlowCryptManifest, BrowserMsg, BrowserWidnow, Bm, GoogleAuthWindowResult$result } from './extension.js';
import { Ui, Env } from './browser.js';
import { Att } from './att.js';
import { Mime, SendableMsgBody, FlatHeaders } from './mime.js';
import { PaymentMethod } from './account.js';
import { Catch } from './catch.js';

declare const openpgp: typeof OpenPGP;

type ParsedAttest$content = {
  [key: string]: string | undefined; action?: string; attester?: string; email_hash?: string;
  fingerprint?: string; fingerprint_old?: string; random?: string;
};
type ParsedAttest = { success: boolean; content: ParsedAttest$content; text: string | null; error: string | null; };
type FcAuthToken = { account: string, token: string };
type FcAuthMethods = 'uuid' | FcAuthToken | null;
type GoogleAuthTokenInfo = { issued_to: string, audience: string, scope: string, expires_in: number, access_type: 'offline' };
type GoogleAuthTokensResponse = { access_token: string, expires_in: number, refresh_token?: string };
type AuthResultSuccess = { success: true, result: 'Success', acctEmail: string, messageId?: string };
type AuthResultError = { success: false, result: GoogleAuthWindowResult$result, acctEmail: string | null, messageId?: string, error?: string };
type AuthResult = AuthResultSuccess | AuthResultError;
type SubscriptionLevel = 'pro' | null;
type ReqFmt = 'JSON' | 'FORM';
type ResFmt = 'json';
type ReqMethod = 'POST' | 'GET' | 'DELETE' | 'PUT';
type ProviderContactsResults = { new: Contact[], all: Contact[] };
type RawAjaxError = {
  // getAllResponseHeaders?: () => any,
  // getResponseHeader?: (e: string) => any,
  readyState: number,
  responseText?: "",
  status?: number,
  statusText?: string,
};

export type ChunkedCb = (r: ProviderContactsResults) => void;
export type AuthReq = { tabId: string, acctEmail: string | null, scopes: string[], messageId?: string, authResponderId: string, omitReadScope?: boolean };
export type ProgressCb = (percent: number | null, loaded: number | null, total: number | null) => void;
export type ProgressCbs = { upload?: ProgressCb | null, download?: ProgressCb | null };
export type GmailResponseFormat = 'raw' | 'full' | 'metadata';
export type ProviderContactsQuery = { substring: string };
export type SendableMsg = { headers: FlatHeaders; from: string; to: string[]; subject: string; body: SendableMsgBody; atts: Att[]; thread: string | null; };
export type SubscriptionInfo = { active: boolean | null; method: PaymentMethod | null; level: SubscriptionLevel; expire: string | null; };
export type PubkeySearchResult = { email: string; pubkey: string | null; attested: boolean | null; has_cryptup: boolean | null; longid: string | null; };
export type AwsS3UploadItem = { baseUrl: string, fields: { key: string; file?: Att }, att: Att };

export class AjaxError extends Error {
  public xhr: any;
  public status: number;
  public url: string;
  public responseText: string;
  public statusText: string;
  constructor(xhr: RawAjaxError, url: string) {
    super(`${String(xhr.statusText || '(no status text)')}: ${String(xhr.status || -1)}`);
    this.xhr = xhr;
    this.status = typeof xhr.status === 'number' ? xhr.status : -1;
    this.url = url;
    this.responseText = xhr.responseText || '';
    this.statusText = xhr.statusText || '(no status text)';
  }
}

export class ApiErrorResponse extends Error {
  public response: any;
  public url: any;
  constructor(response: any, url: string) {
    super(`Error response from ${url}`);
    this.response = response;
  }
}

export namespace R { // responses

  export type FcHelpFeedback = { sent: boolean };
  export type FcAccountLogin = { registered: boolean, verified: boolean, subscription: SubscriptionInfo };
  export type FcAccountUpdate$result = { alias: string, email: string, intro: string, name: string, photo: string, default_message_expire: number };
  export type FcAccountUpdate = { result: FcAccountUpdate$result, updated: boolean };
  export type FcAccountSubscribe = { subscription: SubscriptionInfo };
  export type FcAccountCheck = { email: string | null, subscription: { level: SubscriptionLevel, expire: string, expired: boolean, method: PaymentMethod | null } | null };

  export type FcMsgPresignFiles = { approvals: { base_url: string, fields: { key: string } }[] };
  export type FcMsgConfirmFiles = { confirmed: string[], admin_codes: string[] };
  export type FcMsgToken = { token: string };
  export type FcMsgUpload = { short: string, admin_code: string };
  export type FcLinkMsg = { expire: string, deleted: boolean, url: string, expired: boolean };
  export type FcLinkMe$profile = {
    alias: string | null, name: string | null, photo: string | null, photo_circle: boolean, intro: string | null, web: string | null,
    phone: string | null, token: string | null, subscription_level: string | null, subscription_method: string | null, email: string | null
  };
  export type FcLinkMe = { profile: null | FcLinkMe$profile };
  export type ApirFcMsgExpiration = { updated: boolean };

  export type AttInitialConfirm = { attested: boolean };
  export type AttReplaceRequest = { saved: boolean };
  export type AttReplaceConfirm = { attested: boolean };
  export type AttTestWelcome = { sent: boolean };
  export type AttInitialLegacySugmit = { attested: boolean, saved: boolean };
  export type AttKeyserverDiagnosis = { hasPubkeyMissing: boolean, hasPubkeyMismatch: boolean, results: Dict<{ attested: boolean, pubkey: string | null, match: boolean }> };

  export type GmailUsersMeProfile = { emailAddress: string, historyId: string, messagesTotal: number, threadsTotal: string };
  export type GmailMsg$header = { name: string, value: string };
  export type GmailMsg$payload$body = { attachmentId: string, size: number, data?: string };
  export type GmailMsg$payload$part = { body?: GmailMsg$payload$body, filename?: string, mimeType?: string, headers?: GmailMsg$header[] };
  export type GmailMsg$payload = { parts?: GmailMsg$payload$part[], headers?: GmailMsg$header[], mimeType?: string, body?: GmailMsg$payload$body };
  export type GmailMsg$labelId = 'INBOX' | 'UNREAD' | 'CATEGORY_PERSONAL' | 'IMPORTANT' | 'SENT' | 'CATEGORY_UPDATES';
  export type GmailMsg = {
    id: string, historyId: string, threadId?: string | null, payload: GmailMsg$payload, raw?: string, internalDate?: number | string,
    labelIds: GmailMsg$labelId[], snippet?: string
  };
  export type GmailMsgList$message = { id: string, threadId: string };
  export type GmailMsgList = { messages?: GmailMsgList$message[], resultSizeEstimate: number };
  export type GmailLabels$label = {
    id: string, name: string, messageListVisibility: 'show' | 'hide', labelListVisibility: 'labelShow' | 'labelHide', type: 'user' | 'system',
    messagesTotal?: number, messagesUnread?: number, threadsTotal?: number, threadsUnread?: number, color?: { textColor: string, backgroundColor: string }
  };
  export type GmailLabels = { labels: GmailLabels$label[] };
  export type GmailAtt = { attachmentId: string, size: number, data: string };
  export type GmailMsgSend = { id: string };
  export type GmailThread = { id: string, historyId: string, messages: GmailMsg[] };
  export type GmailThreadList = { threads: { historyId: string, id: string, snippet: string }[], nextPageToken: string, resultSizeEstimate: number };
  export type GmailDraftCreate = { id: string };
  export type GmailDraftDelete = {};
  export type GmailDraftUpdate = {};
  export type GmailDraftGet = { id: string, message: GmailMsg };
  export type GmailDraftSend = {};

  export type GooglePlusPeopleMe = { displayName: string, language: string, image: { url: string } };

}

export class Api {

  private static GMAIL_USELESS_CONTACTS_FILTER = '-to:txt.voice.google.com -to:reply.craigslist.org -to:sale.craigslist.org -to:hous.craigslist.org';
  private static GMAIL_SCOPE_DICT: Dict<string> = { read: 'https://www.googleapis.com/auth/gmail.readonly', compose: 'https://www.googleapis.com/auth/gmail.compose' };
  private static GOOGLE_OAUTH2 = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest ? (chrome.runtime.getManifest() as FlowCryptManifest).oauth2 : null;
  public static GMAIL_RECOVERY_EMAIL_SUBJECTS = ['Your FlowCrypt Backup',
    'Your CryptUp Backup', 'All you need to know about CryptUP (contains a backup)', 'CryptUP Account Backup'];

  public static auth = {
    window: (authUrl: string, winClosedByUser: () => void) => {
      const authCodeWin = window.open(authUrl, '_blank', 'height=600,left=100,menubar=no,status=no,toolbar=no,top=100,width=500');
      const winClosedTimer = Catch.setHandledInterval(() => {
        if (authCodeWin !== null && authCodeWin.closed) {
          clearInterval(winClosedTimer);
          winClosedByUser();
        }
      }, 500);
      return () => {
        clearInterval(winClosedTimer);
        if (authCodeWin !== null) {
          authCodeWin.close();
        }
      };
    },
    // parseIdToken: (idToken: string) => JSON.parse(atob(idToken.split(/\./g)[1])),
  };

  public static err = {
    isNetErr: (e: any) => {
      if (e instanceof TypeError && (e.message === 'Failed to fetch' || e.message === 'NetworkError when attempting to fetch resource.')) {
        return true; // openpgp.js uses fetch()... which produces these errors
      }
      if (e && typeof e === 'object') {
        if (Api.err.isStandardErr(e, 'network')) { // StandardError
          return true;
        }
        if (e instanceof AjaxError && e.status === 0 && e.statusText === 'error') { // $.ajax network error
          return true;
        }
      }
      return false;
    },
    isAuthErr: (e: any) => {
      if (e && typeof e === 'object') {
        if (Api.err.isStandardErr(e, 'auth')) {
          return true; // API auth error response
        }
        if (e instanceof AjaxError && e.status === 401) { // $.ajax auth error
          return true;
        }
      }
      return false;
    },
    isStandardErr: (e: any, internalType: string) => {
      if (e && typeof e === 'object') {
        if ((e as StandardError).internal === internalType) {
          return true;
        }
        if ((e as { error: StandardError }).error && typeof (e as { error: StandardError }).error === 'object' && (e as { error: StandardError }).error.internal === internalType) {
          return true;
        }
      }
      return false;
    },
    isAuthPopupNeeded: (e: any) => {
      if (e instanceof AjaxError && e.status === 400 && typeof e.responseText === 'string') {
        try {
          const json = JSON.parse(e.responseText);
          if (json && (json as any).error === 'invalid_grant') {
            const jsonErrorDesc = (json as any).error_description;
            return jsonErrorDesc === 'Bad Request' || jsonErrorDesc === 'Token has been expired or revoked.';
          }
        } catch (e) {
          return false;
        }
      }
      return false;
    },
    isMailOrAcctDisabled: (e: any): boolean => {
      if (Api.err.isBadReq(e) && typeof e.responseText === 'string') {
        return e.responseText.indexOf('Mail service not enabled') !== -1 || e.responseText.indexOf('Account has been deleted') !== -1;
      }
      return false;
    },
    isNotFound: (e: any): e is AjaxError => e instanceof AjaxError && e.status === 404, // $.ajax rejection
    isBadReq: (e: any): e is AjaxError => e instanceof AjaxError && e.status === 400, // $.ajax rejection
    isServerErr: (e: any): e is AjaxError => e instanceof AjaxError && e.status >= 500, // $.ajax rejection
  };

  public static google = {
    plus: {
      peopleMe: (acctEmail: string): Promise<R.GooglePlusPeopleMe> => Api.internal.apiGoogleCall(acctEmail, 'GET', 'https://www.googleapis.com/plus/v1/people/me', { alt: 'json' }),
    },
    // todo - move to Extension
    authPopup: (acctEmail: string | null, tabId: string, omitReadScope = false, scopes: string[] = []): Promise<AuthResult> => new Promise((resolve, reject) => {
      if (Env.isBackgroundPage()) {
        throw { code: null, message: 'Cannot produce auth window from background script' };
      }
      let responseHandled = false;
      Api.internal.apiGoogleAuthPopupPrepareAuthReqScopes(acctEmail, scopes, omitReadScope).then(scopes => {
        const authRequest: AuthReq = { tabId, acctEmail, authResponderId: Str.sloppyRandom(20), scopes };
        BrowserMsg.addListener('google_auth_window_result', (result: Bm.GoogleAuthWindowResult, sender, closeAuthWin: (r: Bm.Res.GoogleAuthWindowResult) => void) => {
          if (result.state.authResponderId === authRequest.authResponderId && !responseHandled) {
            responseHandled = true;
            Api.internal.googleAuthWinResHandler(result).then(resolve, reject);
            closeAuthWin({});
          }
        });
        BrowserMsg.listen(authRequest.tabId);
        const authCodeWin = window.open(Api.internal.apiGoogleAuthCodeUrl(authRequest), '_blank', 'height=700,left=100,menubar=no,status=no,toolbar=no,top=50,width=600');
        // auth window will show up. Inside the window, google_auth_code.js gets executed which will send
        // a 'gmail_auth_code_result' chrome message to 'google_auth.google_auth_window_result_handler' and close itself
        if (Catch.browser().name !== 'firefox') {
          const winClosedTimer = Catch.setHandledInterval(() => {
            if (authCodeWin === null || typeof authCodeWin === 'undefined') {
              clearInterval(winClosedTimer);  // on firefox it seems to be sometimes returning a null, due to popup blocking
            } else if (authCodeWin.closed) {
              clearInterval(winClosedTimer);
              if (!responseHandled) {
                resolve({ success: false, result: 'Closed', acctEmail: authRequest.acctEmail, messageId: authRequest.messageId });
                responseHandled = true;
              }
            }
          }, 250);
        }
      }, reject);
    }),
  };

  public static common = {
    msg: async (acctEmail: string, from: string = '', to: string[] = [], subject: string = '', by: SendableMsgBody, atts?: Att[], threadRef?: string): Promise<SendableMsg> => {
      const [primaryKi] = await Store.keysGet(acctEmail, ['primary']);
      return {
        headers: primaryKi ? { OpenPGP: `id=${primaryKi.fingerprint}` } : {},
        from,
        to: Array.isArray(to) ? to as string[] : (to as string).split(','),
        subject,
        body: typeof by === 'object' ? by : { 'text/plain': by },
        atts: atts || [],
        thread: threadRef || null,
      };
    },
    replyCorrespondents: (acctEmail: string, addresses: string[], lastMsgSender: string | null, lastMsgRecipients: string[]) => {
      const replyToEstimate = lastMsgRecipients;
      if (lastMsgSender) {
        replyToEstimate.unshift(lastMsgSender);
      }
      let replyTo: string[] = [];
      let myEmail = acctEmail;
      for (const email of replyToEstimate) {
        if (email) {
          if (Value.is(Str.parseEmail(email).email).in(addresses)) { // my email
            myEmail = email;
          } else if (!Value.is(Str.parseEmail(email).email).in(replyTo)) { // skip duplicates
            replyTo.push(Str.parseEmail(email).email); // reply to all except my emails
          }
        }
      }
      if (!replyTo.length) { // happens when user sends email to itself - all reply_to_estimage contained his own emails and got removed
        replyTo = Value.arr.unique(replyToEstimate);
      }
      return { to: replyTo, from: myEmail };
    },
  };

  public static gmail = {
    query: {
      or: (arr: string[], quoted: boolean = false) => {
        if (quoted) {
          return '("' + arr.join('") OR ("') + '")';
        } else {
          return '(' + arr.join(') OR (') + ')';
        }
      },
      backups: (acctEmail: string) => {
        return [
          'from:' + acctEmail,
          'to:' + acctEmail,
          '(subject:"' + Api.GMAIL_RECOVERY_EMAIL_SUBJECTS.join('" OR subject: "') + '")',
          '-is:spam',
        ].join(' ');
      },
    },
    scope: (scope: string[]): string[] => scope.map(s => Api.GMAIL_SCOPE_DICT[s] as string),
    hasScope: (scopes: string[], scope: string) => scopes && Value.is(Api.GMAIL_SCOPE_DICT[scope]).in(scopes),
    usersMeProfile: async (acctEmail: string | null, accessToken?: string): Promise<R.GmailUsersMeProfile> => {
      const url = 'https://www.googleapis.com/gmail/v1/users/me/profile';
      if (acctEmail && !accessToken) {
        return await Api.internal.apiGoogleCall(acctEmail, 'GET', url, {}) as R.GmailUsersMeProfile;
      } else if (!acctEmail && accessToken) {
        const contentType = 'application/json; charset=UTF-8';
        const headers = { 'Authorization': `Bearer ${accessToken}` };
        return await $.ajax({ url, method: 'GET', headers, crossDomain: true, contentType, async: true }) as R.GmailUsersMeProfile;
      } else {
        throw new Error('Api.gmail.users_me_profile: need either account_email or access_token');
      }
    },
    threadGet: (acctEmail: string, threadId: string, format?: GmailResponseFormat): Promise<R.GmailThread> => Api.internal.apiGmailCall(acctEmail, 'GET', `threads/${threadId}`, {
      format,
    }),
    threadList: (acctEmail: string, labelId: string): Promise<R.GmailThreadList> => Api.internal.apiGmailCall(acctEmail, 'GET', `threads`, {
      labelIds: labelId !== 'ALL' ? labelId : undefined,
      includeSpamTrash: Boolean(labelId === 'SPAM' || labelId === 'TRASH'),
      // pageToken: page_token,
      // q,
      // maxResults
    }),
    threadModify: (acctEmail: string, id: string, rmLabels: string[], addLabels: string[]): Promise<R.GmailThread> => Api.internal.apiGmailCall(acctEmail, 'POST', `threads/${id}/modify`, {
      removeLabelIds: rmLabels || [], // todo - insufficient permission - need https://github.com/FlowCrypt/flowcrypt-browser/issues/1304
      addLabelIds: addLabels || [],
    }),
    draftCreate: (acctEmail: string, mimeMsg: string, threadId: string): Promise<R.GmailDraftCreate> => Api.internal.apiGmailCall(acctEmail, 'POST', 'drafts', {
      message: {
        raw: Str.base64urlEncode(mimeMsg),
        threadId: threadId || null,
      },
    }),
    draftDelete: (acctEmail: string, id: string): Promise<R.GmailDraftDelete> => Api.internal.apiGmailCall(acctEmail, 'DELETE', 'drafts/' + id, null),
    draftUpdate: (acctEmail: string, id: string, mimeMsg: string): Promise<R.GmailDraftUpdate> => Api.internal.apiGmailCall(acctEmail, 'PUT', `drafts/${id}`, {
      message: {
        raw: Str.base64urlEncode(mimeMsg),
      },
    }),
    draftGet: (acctEmail: string, id: string, format: GmailResponseFormat = 'full'): Promise<R.GmailDraftGet> => Api.internal.apiGmailCall(acctEmail, 'GET', `drafts/${id}`, {
      format,
    }),
    draftSend: (acctEmail: string, id: string): Promise<R.GmailDraftSend> => Api.internal.apiGmailCall(acctEmail, 'POST', 'drafts/send', {
      id,
    }),
    msgSend: async (acctEmail: string, message: SendableMsg, progressCb?: ProgressCb): Promise<R.GmailMsgSend> => {
      message.headers.From = message.from;
      message.headers.To = message.to.join(',');
      message.headers.Subject = message.subject;
      const mimeMsg = await Mime.encode(message.body, message.headers, message.atts);
      const request = Api.internal.encodeAsMultipartRelated({ 'application/json; charset=UTF-8': JSON.stringify({ threadId: message.thread }), 'message/rfc822': mimeMsg });
      return Api.internal.apiGmailCall(acctEmail, 'POST', 'messages/send', request.body, { upload: progressCb || Value.noop }, request.contentType);
    },
    msgList: (acctEmail: string, q: string, includeDeleted: boolean = false): Promise<R.GmailMsgList> => Api.internal.apiGmailCall(acctEmail, 'GET', 'messages', {
      q,
      includeSpamTrash: includeDeleted,
    }),
    msgGet: (acctEmail: string, msgId: string, format: GmailResponseFormat): Promise<R.GmailMsg> => Api.internal.apiGmailCall(acctEmail, 'GET', `messages/${msgId}`, {
      format: format || 'full',
    }),
    msgsGet: (acctEmail: string, msgIds: string[], format: GmailResponseFormat): Promise<R.GmailMsg[]> => {
      return Promise.all(msgIds.map(id => Api.gmail.msgGet(acctEmail, id, format)));
    },
    labelsGet: (acctEmail: string): Promise<R.GmailLabels> => Api.internal.apiGmailCall(acctEmail, 'GET', `labels`, {}),
    attGet: async (acctEmail: string, msgId: string, attId: string, progressCb: ProgressCb | null = null): Promise<R.GmailAtt> => {
      const r = await Api.internal.apiGmailCall(acctEmail, 'GET', `messages/${msgId}/attachments/${attId}`, {}, { download: progressCb }) as R.GmailAtt;
      r.data = Str.base64urlDecode(r.data);
      return r;
    },
    attGetChunk: (acctEmail: string, messageId: string, attId: string): Promise<string> => new Promise(async (resolve, reject) => {
      const minBytes = 1000;
      let processed = 0;
      const processChunkAndResolve = (chunk: string) => {
        if (!processed++) {
          // make json end guessing easier
          chunk = chunk.replace(/[\n\s\r]/g, '');
          // the response is a chunk of json that may not have ended. One of:
          // {"length":12345,"data":"kksdwei
          // {"length":12345,"data":"kksdweiooiowei
          // {"length":12345,"data":"kksdweiooiowei"
          // {"length":12345,"data":"kksdweiooiowei"}
          if (chunk[chunk.length - 1] !== '"' && chunk[chunk.length - 2] !== '"') {
            chunk += '"}'; // json end
          } else if (chunk[chunk.length - 1] !== '}') {
            chunk += '}'; // json end
          }
          let parsedJsonDataField;
          try {
            parsedJsonDataField = JSON.parse(chunk).data; // tslint:disable-line:no-unsafe-any
          } catch (e) {
            console.log(e);
            reject({ code: null, message: "Chunk response could not be parsed" });
            return;
          }
          for (let i = 0; parsedJsonDataField && i < 50; i++) {
            try {
              resolve(Str.base64urlDecode(parsedJsonDataField)); // tslint:disable-line:no-unsafe-any
              return;
            } catch (e) {
              // the chunk of data may have been cut at an inconvenient index
              // shave off up to 50 trailing characters until it can be decoded
              parsedJsonDataField = parsedJsonDataField.slice(0, -1); // tslint:disable-line:no-unsafe-any
            }
          }
          reject({ code: null, message: "Chunk response could not be decoded" });
        }
      };
      Api.internal.googleApiAuthHeader(acctEmail).then(authToken => {
        const r = new XMLHttpRequest();
        r.open('GET', `https://www.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${attId}`, true);
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
              reject({ code: status, message: `Fail status ${status} received when downloading a chunk` });
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
            } else {  // done as a fail - reject
              reject({ code: null, message: 'Network connection error when downloading a chunk', internal: 'network' });
              window.clearInterval(responsePollInterval);
            }
          }
        };
      }).catch(reject);
    }),
    findHeader: (apiGmailMsgObj: R.GmailMsg | R.GmailMsg$payload, headerName: string) => {
      const node: R.GmailMsg$payload = apiGmailMsgObj.hasOwnProperty('payload') ? (apiGmailMsgObj as R.GmailMsg).payload : apiGmailMsgObj as R.GmailMsg$payload;
      if (typeof node.headers !== 'undefined') {
        for (const header of node.headers) {
          if (header.name.toLowerCase() === headerName.toLowerCase()) {
            return header.value;
          }
        }
      }
      return null;
    },
    findAtts: (msgOrPayloadOrPart: R.GmailMsg | R.GmailMsg$payload | R.GmailMsg$payload$part, internalResults: Att[] = [], internalMsgId: string | null = null) => {
      if (msgOrPayloadOrPart.hasOwnProperty('payload')) {
        internalMsgId = (msgOrPayloadOrPart as R.GmailMsg).id;
        Api.gmail.findAtts((msgOrPayloadOrPart as R.GmailMsg).payload, internalResults, internalMsgId);
      }
      if (msgOrPayloadOrPart.hasOwnProperty('parts')) {
        for (const part of (msgOrPayloadOrPart as R.GmailMsg$payload).parts!) {
          Api.gmail.findAtts(part, internalResults, internalMsgId);
        }
      }
      if (msgOrPayloadOrPart.hasOwnProperty('body') && (msgOrPayloadOrPart as R.GmailMsg$payload$part).body!.hasOwnProperty('attachmentId')) {
        internalResults.push(new Att({
          msgId: internalMsgId,
          id: (msgOrPayloadOrPart as R.GmailMsg$payload$part).body!.attachmentId,
          length: (msgOrPayloadOrPart as R.GmailMsg$payload$part).body!.size,
          name: (msgOrPayloadOrPart as R.GmailMsg$payload$part).filename,
          type: (msgOrPayloadOrPart as R.GmailMsg$payload$part).mimeType,
          inline: (Api.gmail.findHeader(msgOrPayloadOrPart, 'content-disposition') || '').toLowerCase().indexOf('inline') === 0,
        }));
      }
      return internalResults;
    },
    findBodies: (gmailMsg: R.GmailMsg | R.GmailMsg$payload | R.GmailMsg$payload$part, internalResults: SendableMsgBody = {}): SendableMsgBody => {
      const isGmailMsg = (v: any): v is R.GmailMsg => v && typeof (v as R.GmailMsg).payload !== 'undefined';
      const isGmailMsgPayload = (v: any): v is R.GmailMsg$payload => v && typeof (v as R.GmailMsg$payload).parts !== 'undefined';
      const isGmailMsgPayloadPart = (v: any): v is R.GmailMsg$payload$part => v && typeof (v as R.GmailMsg$payload$part).body !== 'undefined';
      if (isGmailMsg(gmailMsg)) {
        Api.gmail.findBodies(gmailMsg.payload, internalResults);
      }
      if (isGmailMsgPayload(gmailMsg) && gmailMsg.parts) {
        for (const part of gmailMsg.parts) {
          Api.gmail.findBodies(part, internalResults);
        }
      }
      if (isGmailMsgPayloadPart(gmailMsg) && gmailMsg.body && typeof gmailMsg.body.data !== 'undefined' && gmailMsg.body.size !== 0) {
        if (gmailMsg.mimeType) {
          internalResults[gmailMsg.mimeType] = gmailMsg.body.data;
        }
      }
      return internalResults;
    },
    fetchAtts: async (acctEmail: string, atts: Att[]) => {
      const responses = await Promise.all(atts.map(a => Api.gmail.attGet(acctEmail, a.msgId!, a.id!)));
      for (const i of responses.keys()) {
        atts[i].setData(responses[i].data);
      }
    },
    searchContacts: async (acctEmail: string, userQuery: string, knownContacts: Contact[], chunkedCb: ChunkedCb) => {
      // This will keep triggering callback with new emails as they are being discovered
      const gmailQuery = ['is:sent', Api.GMAIL_USELESS_CONTACTS_FILTER];
      if (userQuery) {
        const variationsOfTo = userQuery.split(/[ .]/g).filter(v => !Value.is(v).in(['com', 'org', 'net']));
        if (!Value.is(userQuery).in(variationsOfTo)) {
          variationsOfTo.push(userQuery);
        }
        gmailQuery.push(`(to:${variationsOfTo.join(' OR to:')})`);
      }
      const filteredContacts = knownContacts.filter(c => Str.isEmailValid(c.email));
      for (const contact of filteredContacts) {
        gmailQuery.push(`-to:${contact.email}`);
      }
      await Api.internal.apiGmailLoopThroughEmailsToCompileContacts(acctEmail, gmailQuery.join(' '), chunkedCb);
    },
    /*
    * Extracts the encrypted message from gmail api. Sometimes it's sent as a text, sometimes html, sometimes attachments in various forms.
    * success_callback(str armored_pgp_message)
    * error_callback(str error_type, str html_formatted_data_to_display_to_user)
    *    ---> html_formatted_data_to_display_to_user might be unknown type of mime message, or pgp message with broken format, etc.
    *    ---> The motivation is that user might have other tool to process this. Also helps debugging issues in the field.
    */
    extractArmoredBlock: async (acctEmail: string, msgId: string, format: GmailResponseFormat): Promise<string> => {
      const gmailMsg = await Api.gmail.msgGet(acctEmail, msgId, format);
      if (format === 'full') {
        const bodies = Api.gmail.findBodies(gmailMsg);
        const atts = Api.gmail.findAtts(gmailMsg);
        const armoredMsgFromBodies = Pgp.armor.clip(Str.base64urlDecode(bodies['text/plain'] || '')) || Pgp.armor.clip(Pgp.armor.strip(Str.base64urlDecode(bodies['text/html'] || '')));
        if (armoredMsgFromBodies) {
          return armoredMsgFromBodies;
        } else if (atts.length) {
          for (const att of atts) {
            if (att.treatAs() === 'message') {
              await Api.gmail.fetchAtts(acctEmail, [att]);
              const armoredMsg = Pgp.armor.clip(att.asText());
              if (!armoredMsg) {
                throw new FormatError('Problem extracting armored message', att.asText());
              }
              return armoredMsg;
            }
          }
          throw new FormatError('Armored message not found', JSON.stringify(gmailMsg.payload, undefined, 2));
        } else {
          throw new FormatError('No attachments', JSON.stringify(gmailMsg.payload, undefined, 2));
        }
      } else { // format === raw
        const mimeMsg = await Mime.decode(Str.base64urlDecode(gmailMsg.raw!));
        if (mimeMsg.text !== undefined) {
          const armoredMsg = Pgp.armor.clip(mimeMsg.text); // todo - the message might be in attachments
          if (armoredMsg) {
            return armoredMsg;
          } else {
            throw new FormatError('Could not find armored message in parsed raw mime', Str.base64urlDecode(gmailMsg.raw!));
          }
        } else {
          throw new FormatError('No text in parsed raw mime', Str.base64urlDecode(gmailMsg.raw!));
        }
      }
    },
    fetchMsgsBasedOnQueryAndExtractFirstAvailableHeader: async (acctEmail: string, q: string, headerNames: string[]) => {
      const { messages } = await Api.gmail.msgList(acctEmail, q, false);
      return await Api.internal.apiGmailFetchMsgsSequentiallyFromListAndExtractFirstAvailableHeader(acctEmail, messages || [], headerNames);
    },
    fetchKeyBackups: async (acctEmail: string) => {
      const res = await Api.gmail.msgList(acctEmail, Api.gmail.query.backups(acctEmail), true);
      if (!res.messages) {
        return [];
      }
      const msgIds = res.messages.map(m => m.id);
      const msgs = await Api.gmail.msgsGet(acctEmail, msgIds, 'full');
      let atts: Att[] = [];
      for (const msg of msgs) {
        atts = atts.concat(Api.gmail.findAtts(msg));
      }
      await Api.gmail.fetchAtts(acctEmail, atts);
      const keys: OpenPGP.key.Key[] = [];
      for (const att of atts) {
        try {
          const key = openpgp.key.readArmored(att.asText()).keys[0];
          if (key.isPrivate()) {
            keys.push(key);
          }
        } catch (err) { } // tslint:disable-line:no-empty
      }
      return keys;
    },
  };

  public static attester = {
    lookupEmail: (emails: string[]): Promise<{ results: PubkeySearchResult[] }> => Api.internal.apiAttesterCall('lookup/email', {
      email: emails.map(e => Str.parseEmail(e).email),
    }),
    initialLegacySubmit: (email: string, pubkey: string, attest: boolean = false): Promise<R.AttInitialLegacySugmit> => Api.internal.apiAttesterCall('initial/legacy_submit', {
      email: Str.parseEmail(email).email,
      pubkey: pubkey.trim(),
      attest,
    }),
    initialConfirm: (signedAttestPacket: string): Promise<R.AttInitialConfirm> => Api.internal.apiAttesterCall('initial/confirm', {
      signedMsg: signedAttestPacket,
    }),
    replaceRequest: (email: string, signedAttestPacket: string, newPubkey: string): Promise<R.AttReplaceRequest> => Api.internal.apiAttesterCall('replace/request', {
      signedMsg: signedAttestPacket,
      newPubkey,
      email,
    }),
    replaceConfirm: (signedAttestPacket: string): Promise<R.AttReplaceConfirm> => Api.internal.apiAttesterCall('replace/confirm', {
      signedMsg: signedAttestPacket,
    }),
    testWelcome: (email: string, pubkey: string): Promise<R.AttTestWelcome> => Api.internal.apiAttesterCall('test/welcome', {
      email,
      pubkey,
    }),
    diagnoseKeyserverPubkeys: async (acctEmail: string): Promise<R.AttKeyserverDiagnosis> => {
      const diagnosis: R.AttKeyserverDiagnosis = { hasPubkeyMissing: false, hasPubkeyMismatch: false, results: {} };
      const { addresses } = await Store.getAcct(acctEmail, ['addresses']);
      const storedKeys = await Store.keysGet(acctEmail);
      const storedKeysLongids = storedKeys.map(ki => ki.longid);
      const { results } = await Api.attester.lookupEmail(Value.arr.unique([acctEmail].concat(addresses || [])));
      for (const pubkeySearchResult of results) {
        if (!pubkeySearchResult.pubkey) {
          diagnosis.hasPubkeyMissing = true;
          diagnosis.results[pubkeySearchResult.email] = { attested: false, pubkey: null, match: false };
        } else {
          let match = true;
          if (!Value.is(Pgp.key.longid(pubkeySearchResult.pubkey)).in(storedKeysLongids)) {
            diagnosis.hasPubkeyMismatch = true;
            match = false;
          }
          diagnosis.results[pubkeySearchResult.email] = { pubkey: pubkeySearchResult.pubkey, attested: pubkeySearchResult.attested || false, match };
        }
      }
      return diagnosis;
    },
    packet: {
      createSign: async (values: Dict<string>, decryptedPrv: OpenPGP.key.Key) => {
        const lines: string[] = [];
        for (const key of Object.keys(values)) {
          lines.push(key + ':' + values[key]);
        }
        const contentText = lines.join('\n');
        const packet = Api.attester.packet.parse(Api.internal.apiAttesterPacketArmor(contentText));
        if (packet.success !== true) {
          throw { code: null, message: packet.error, internal: 'parse' };
        }
        return await Pgp.msg.sign(decryptedPrv, contentText);
      },
      isValidHashFormat: (v: string) => /^[A-F0-9]{40}$/.test(v),
      parse: (text: string): ParsedAttest => {
        const acceptedValues = {
          'ACT': 'action',
          'ATT': 'attester',
          'ADD': 'email_hash',
          'PUB': 'fingerprint',
          'OLD': 'fingerprint_old',
          'RAN': 'random',
        } as Dict<string>;
        const result: ParsedAttest = {
          success: false,
          content: {},
          error: null as string | null,
          text: null as string | null,
        };
        const packetHeaders = Pgp.armor.headers('attestPacket', 're');
        const matches = text.match(RegExp(packetHeaders.begin + '([^]+)' + packetHeaders.end, 'm'));
        if (matches && matches[1]) {
          result.text = matches[1].replace(/^\s+|\s+$/g, '');
          const lines = result.text.split('\n');
          for (const line of lines) {
            const lineParts = line.replace('\n', '').replace(/^\s+|\s+$/g, '').split(':');
            if (lineParts.length !== 2) {
              result.error = 'Wrong content line format';
              result.content = {};
              return result;
            }
            if (!acceptedValues[lineParts[0]]) {
              result.error = 'Unknown line key';
              result.content = {};
              return result;
            }
            if (result.content[acceptedValues[lineParts[0]]]) {
              result.error = 'Duplicate line key';
              result.content = {};
              return result;
            }
            result.content[acceptedValues[lineParts[0]]] = lineParts[1];
          }
          if (result.content.fingerprint && !Api.attester.packet.isValidHashFormat(result.content.fingerprint)) {
            result.error = 'Wrong PUB line value format';
            result.content = {};
            return result;
          }
          if (result.content.email_hash && !Api.attester.packet.isValidHashFormat(result.content.email_hash)) {
            result.error = 'Wrong ADD line value format';
            result.content = {};
            return result;
          }
          if (result.content.str_random && !Api.attester.packet.isValidHashFormat(result.content.str_random)) {
            result.error = 'Wrong RAN line value format';
            result.content = {};
            return result;
          }
          if (result.content.fingerprint_old && !Api.attester.packet.isValidHashFormat(result.content.fingerprint_old)) {
            result.error = 'Wrong OLD line value format';
            result.content = {};
            return result;
          }
          if (result.content.action && !Value.is(result.content.action).in(['INITIAL', 'REQUEST_REPLACEMENT', 'CONFIRM_REPLACEMENT'])) {
            result.error = 'Wrong ACT line value format';
            result.content = {};
            return result;
          }
          if (result.content.attester && !Value.is(result.content.attester).in(['CRYPTUP'])) {
            result.error = 'Wrong ATT line value format';
            result.content = {};
            return result;
          }
          result.success = true;
          return result;
        } else {
          result.error = 'Could not locate packet headers';
          result.content = {};
          return result;
        }
      },
    },
  };

  public static fc = {
    url: (type: string, variable = '') => {
      return ({
        'api': 'https://flowcrypt.com/api/',
        'me': 'https://flowcrypt.com/me/' + variable,
        'pubkey': 'https://flowcrypt.com/pub/' + variable,
        'decrypt': 'https://flowcrypt.com/' + variable,
        'web': 'https://flowcrypt.com/',
      } as Dict<string>)[type];
    },
    helpFeedback: (acctEmail: string, message: string): Promise<R.FcHelpFeedback> => Api.internal.apiFcCall('help/feedback', {
      email: acctEmail,
      message,
    }),
    helpUninstall: (email: string, client: string) => Api.internal.apiFcCall('help/uninstall', {
      email,
      client,
      metrics: null,
    }),
    accountLogin: async (acctEmail: string, token: string | null = null): Promise<{ verified: boolean, subscription: SubscriptionInfo }> => {
      const authInfo = await Store.authInfo();
      const uuid = authInfo.uuid || Pgp.hash.sha1(Pgp.password.random());
      const account = authInfo.acctEmail || acctEmail;
      const response = await Api.internal.apiFcCall('account/login', {
        account,
        uuid,
        token,
      }) as R.FcAccountLogin;
      if (response.registered !== true) {
        throw new Error('account_login did not result in successful registration');
      }
      await Store.setGlobal({ cryptup_account_email: account, cryptup_account_uuid: uuid, cryptup_account_subscription: response.subscription });
      return { verified: response.verified === true, subscription: response.subscription };
    },
    accountCheck: (emails: string[]) => Api.internal.apiFcCall('account/check', {
      emails,
    }) as Promise<R.FcAccountCheck>,
    accountCheckSync: async () => { // callbacks true on updated, false not updated, null for could not fetch
      const emails = await Store.acctEmailsGet();
      if (emails.length) {
        const response = await Api.fc.accountCheck(emails);
        const authInfo = await Store.authInfo();
        const subscription = await Store.subscription();
        const globalStoreUpdate: GlobalStore = {};
        if (response.email) {
          if (response.email !== authInfo.acctEmail) {
            // will fail auth when used on server, user will be prompted to verify this new device when that happens
            globalStoreUpdate.cryptup_account_email = response.email;
            globalStoreUpdate.cryptup_account_uuid = Pgp.hash.sha1(Pgp.password.random());
          }
        } else {
          if (authInfo.acctEmail) {
            globalStoreUpdate.cryptup_account_email = null;
            globalStoreUpdate.cryptup_account_uuid = null;
          }
        }
        if (response.subscription) {
          const rs = response.subscription;
          if (rs.level !== subscription.level || rs.method !== subscription.method || rs.expire !== subscription.expire || subscription.active !== !rs.expired) {
            globalStoreUpdate.cryptup_account_subscription = { active: !rs.expired, method: rs.method, level: rs.level, expire: rs.expire };
          }
        } else {
          if (subscription.level || subscription.expire || subscription.active || subscription.method) {
            globalStoreUpdate.cryptup_account_subscription = null;
          }
        }
        if (Object.keys(globalStoreUpdate).length) {
          Catch.log('updating account subscription from ' + subscription.level + ' to ' + (response.subscription ? response.subscription.level : null), response);
          await Store.setGlobal(globalStoreUpdate);
          return true;
        } else {
          return false;
        }
      }
      return undefined;
    },
    accountUpdate: async (updateValues?: Dict<Serializable>): Promise<R.FcAccountUpdate> => {
      const authInfo = await Store.authInfo();
      const request = { account: authInfo.acctEmail, uuid: authInfo.uuid } as Dict<Serializable>;
      if (updateValues) {
        for (const k of Object.keys(updateValues)) {
          request[k] = updateValues[k];
        }
      }
      return await Api.internal.apiFcCall('account/update', request) as R.FcAccountUpdate;
    },
    accountSubscribe: async (product: string, method: string, paymentSourceToken: string | null = null): Promise<R.FcAccountSubscribe> => {
      const authInfo = await Store.authInfo();
      const response = await Api.internal.apiFcCall('account/subscribe', {
        account: authInfo.acctEmail,
        uuid: authInfo.uuid,
        method,
        source: paymentSourceToken,
        product,
      }) as R.FcAccountSubscribe;
      await Store.setGlobal({ cryptup_account_subscription: response.subscription });
      return response;
    },
    messagePresignFiles: async (atts: Att[], authMethod: FcAuthMethods): Promise<R.FcMsgPresignFiles> => {
      let response: R.FcMsgPresignFiles;
      const lengths = atts.map(a => a.length);
      if (!authMethod) {
        response = await Api.internal.apiFcCall('message/presign_files', {
          lengths,
        }) as R.FcMsgPresignFiles;
      } else if (authMethod === 'uuid') {
        const authInfo = await Store.authInfo();
        response = await Api.internal.apiFcCall('message/presign_files', {
          account: authInfo.acctEmail,
          uuid: authInfo.uuid,
          lengths,
        }) as R.FcMsgPresignFiles;
      } else {
        response = await Api.internal.apiFcCall('message/presign_files', {
          message_token_account: authMethod.account,
          message_token: authMethod.token,
          lengths,
        }) as R.FcMsgPresignFiles;
      }
      if (response.approvals && response.approvals.length === atts.length) {
        return response;
      }
      throw new Error('Could not verify that all files were uploaded properly, please try again.');
    },
    messageConfirmFiles: (identifiers: string[]): Promise<R.FcMsgConfirmFiles> => Api.internal.apiFcCall('message/confirm_files', {
      identifiers,
    }),
    messageUpload: async (encryptedDataArmored: string, authMethod: FcAuthMethods): Promise<R.FcMsgUpload> => { // todo - DEPRECATE THIS. Send as JSON to message/store
      if (encryptedDataArmored.length > 100000) {
        throw { code: null, message: 'Message text should not be more than 100 KB. You can send very long texts as attachments.' };
      }
      const content = new Att({ name: 'cryptup_encrypted_message.asc', type: 'text/plain', data: encryptedDataArmored });
      if (!authMethod) {
        return await Api.internal.apiFcCall('message/upload', { content }, 'FORM') as R.FcMsgUpload;
      } else {
        const authInfo = await Store.authInfo();
        return await Api.internal.apiFcCall('message/upload', { account: authInfo.acctEmail, uuid: authInfo.uuid, content }, 'FORM') as R.FcMsgUpload;
      }
    },
    messageToken: async (): Promise<R.FcMsgToken> => {
      const authInfo = await Store.authInfo();
      return await Api.internal.apiFcCall('message/token', { account: authInfo.acctEmail, uuid: authInfo.uuid }) as R.FcMsgToken;
    },
    messageExpiration: async (adminCodes: string[], addDays: null | number = null): Promise<R.ApirFcMsgExpiration> => {
      const authInfo = await Store.authInfo();
      return await Api.internal.apiFcCall('message/expiration', {
        account: authInfo.acctEmail,
        uuid: authInfo.uuid,
        admin_codes: adminCodes,
        add_days: addDays
      }) as R.ApirFcMsgExpiration;
    },
    messageReply: (short: string, token: string, from: string, to: string, subject: string, message: string) => Api.internal.apiFcCall('message/reply', {
      short,
      token,
      from,
      to,
      subject,
      message,
    }),
    messageContact: (sender: string, message: string, messageToken: FcAuthToken) => Api.internal.apiFcCall('message/contact', {
      message_token_account: messageToken.account,
      message_token: messageToken.token,
      sender,
      message,
    }),
    linkMessage: (short: string): Promise<R.FcLinkMsg> => Api.internal.apiFcCall('link/message', {
      short,
    }),
    linkMe: (alias: string): Promise<R.FcLinkMe> => Api.internal.apiFcCall('link/me', {
      alias,
    }),
  };

  public static aws = {
    s3Upload: (items: AwsS3UploadItem[], progressCb: ProgressCb) => {
      const progress = Value.arr.zeroes(items.length);
      const promises: Promise<void>[] = [];
      if (!items.length) {
        return Promise.resolve(promises);
      }
      for (const i of items.keys()) {
        const fields = items[i].fields;
        fields.file = new Att({ name: 'encrpted_attachment', type: 'application/octet-stream', data: items[i].att.data() });
        promises.push(Api.internal.apiCall(items[i].baseUrl, '', fields, 'FORM', {
          upload: (singleFileProgress: number) => {
            progress[i] = singleFileProgress;
            Ui.event.prevent('spree', () => progressCb(Value.arr.average(progress), null, null)).bind(undefined)(); // tslint:disable-line:no-unsafe-any
          }
        }));
      }
      return Promise.all(promises);
    },
  };

  public static download = (url: string, progress: ProgressCb | null = null): Promise<Uint8Array> => new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('GET', url, true);
    request.responseType = 'arraybuffer';
    if (typeof progress === 'function') {
      request.onprogress = (evt) => progress(evt.lengthComputable ? Math.floor((evt.loaded / evt.total) * 100) : null, evt.loaded, evt.total);
    }
    request.onerror = reject;
    request.onload = e => resolve(new Uint8Array(request.response as ArrayBuffer));
    request.send();
  })

  private static internal = {
    getAjaxProgressXhr: (progressCbs?: ProgressCbs) => {
      const progressPeportingXhr = new XMLHttpRequest();
      if (progressCbs && typeof progressCbs.upload === 'function') {
        progressPeportingXhr.upload.addEventListener('progress', (evt: ProgressEvent) => {
          progressCbs.upload!(evt.lengthComputable ? Math.round((evt.loaded / evt.total) * 100) : null, null, null); // checked ===function above
        }, false);
      }
      if (progressCbs && typeof progressCbs.download === 'function') {
        progressPeportingXhr.onprogress = (evt: ProgressEvent) => {
          progressCbs.download!(evt.lengthComputable ? Math.floor((evt.loaded / evt.total) * 100) : null, evt.loaded, evt.total); // checked ===function above
        };
      }
      return progressPeportingXhr;
    },
    isRawAjaxError: (e: any): e is RawAjaxError => {
      return e && typeof e === 'object' && typeof (e as RawAjaxError).readyState === 'number';
    },
    normalizeAjaxError: (e: any, request: JQueryAjaxSettings) => {
      if (Api.internal.isRawAjaxError(e)) {
        return new AjaxError(e, String(request.url));
      }
      if (e instanceof Error) {
        return e;
      }
      return new Error(`Unknown Ajax error type when calling ${request.url}`);
    },
    apiCall: async (url: string, path: string, fields: Dict<any>, fmt: ReqFmt, progress?: ProgressCbs, headers?: FlatHeaders, resFmt: ResFmt = 'json', method: ReqMethod = 'POST') => {
      progress = progress || {} as ProgressCbs;
      let formattedData: FormData | string;
      let contentType: string | false;
      if (fmt === 'JSON' && fields !== null) {
        formattedData = JSON.stringify(fields);
        contentType = 'application/json; charset=UTF-8';
      } else if (fmt === 'FORM') {
        formattedData = new FormData();
        for (const formFieldName of Object.keys(fields)) {
          const a: Att | string = fields[formFieldName]; // tslint:disable-line:no-unsafe-any
          if (a instanceof Att) {
            formattedData.append(formFieldName, new Blob([a.data()], { type: a.type }), a.name); // xss-none
          } else {
            formattedData.append(formFieldName, a); // xss-none
          }
        }
        contentType = false;
      } else {
        throw Error('unknown format:' + String(fmt));
      }
      const request: JQueryAjaxSettings = {
        xhr: () => Api.internal.getAjaxProgressXhr(progress),
        url: url + path,
        method,
        data: formattedData,
        dataType: resFmt,
        crossDomain: true,
        headers,
        processData: false,
        contentType,
        async: true,
        timeout: typeof progress!.upload === 'function' || typeof progress!.download === 'function' ? undefined : 20000, // substituted with {} above
      };
      try {
        const response = await $.ajax(request);
        if (response && typeof response === 'object' && typeof (response as any).error === 'object') {
          throw new ApiErrorResponse(response, request.url!);
        }
        return response;
      } catch (e) {
        throw Api.internal.normalizeAjaxError(e, request);
      }
    },
    apiGoogleAuthStatePack: (authReq: AuthReq) => Api.GOOGLE_OAUTH2!.state_header + JSON.stringify(authReq),
    apiGoogleAuthCodeUrl: (authReq: AuthReq) => Env.urlCreate(Api.GOOGLE_OAUTH2!.url_code, {
      client_id: Api.GOOGLE_OAUTH2!.client_id,
      response_type: 'code',
      access_type: 'offline',
      state: Api.internal.apiGoogleAuthStatePack(authReq),
      redirect_uri: Api.GOOGLE_OAUTH2!.url_redirect,
      scope: (authReq.scopes || []).join(' '),
      login_hint: authReq.acctEmail,
    }),
    googleAuthSaveTokens: async (acctEmail: string, tokensObj: GoogleAuthTokensResponse, scopes: string[]) => {
      const toSave: AccountStore = {
        google_token_access: tokensObj.access_token,
        google_token_expires: new Date().getTime() + (tokensObj.expires_in as number) * 1000,
        google_token_scopes: scopes,
      };
      if (typeof tokensObj.refresh_token !== 'undefined') {
        toSave.google_token_refresh = tokensObj.refresh_token;
      }
      await Store.setAcct(acctEmail, toSave);
    },
    googleAuthGetTokens: (code: string) => $.ajax({
      url: Env.urlCreate(Api.GOOGLE_OAUTH2!.url_tokens, { grant_type: 'authorization_code', code, client_id: Api.GOOGLE_OAUTH2!.client_id, redirect_uri: Api.GOOGLE_OAUTH2!.url_redirect }),
      method: 'POST',
      crossDomain: true,
      async: true,
    }) as any as Promise<GoogleAuthTokensResponse>,
    googleAuthRefreshToken: (refreshToken: string) => $.ajax({
      url: Env.urlCreate(Api.GOOGLE_OAUTH2!.url_tokens, { grant_type: 'refresh_token', refreshToken, client_id: Api.GOOGLE_OAUTH2!.client_id }),
      method: 'POST',
      crossDomain: true,
      async: true,
    }) as any as Promise<GoogleAuthTokensResponse>,
    googleAuthCheckAccessToken: (accessToken: string) => $.ajax({
      url: Env.urlCreate('https://www.googleapis.com/oauth2/v1/tokeninfo', { access_token: accessToken }),
      crossDomain: true,
      async: true,
    }) as any as Promise<GoogleAuthTokenInfo>,
    googleAuthWinResHandler: async (result: Bm.GoogleAuthWindowResult): Promise<AuthResult> => {
      if (result.result === 'Success') {
        const tokensObj = await Api.internal.googleAuthGetTokens(result.params.code);
        await Api.internal.googleAuthCheckAccessToken(tokensObj.access_token); // https://groups.google.com/forum/#!topic/oauth2-dev/QOFZ4G7Ktzg
        const { emailAddress: acctEmail } = await Api.gmail.usersMeProfile(null, tokensObj.access_token);
        if (result.state.acctEmail !== acctEmail) {
          Catch.report('google_auth_window_result_handler: result.state.acctEmail !== me.emailAddress');
        }
        await Api.internal.googleAuthSaveTokens(acctEmail, tokensObj, result.state.scopes!); // we fill AuthRequest inside .auth_popup()
        return { acctEmail, success: true, result: 'Success', messageId: result.state.messageId };
      } else if (result.result === 'Denied') {
        return { success: false, result: 'Denied', error: result.params.error, acctEmail: result.state.acctEmail, messageId: result.state.messageId };
      } else if (result.result === 'Error') {
        return { success: false, result: 'Error', error: result.params.error, acctEmail: result.state.acctEmail, messageId: result.state.messageId };
      } else {
        throw new Error(`Unknown GoogleAuthWindowResult.result === '${result.result}'`);
      }
    },
    apiGoogleCallRetryAuthErrorOneTime: async (acctEmail: string, request: JQuery.AjaxSettings) => {
      try {
        return await $.ajax(request);
      } catch (firstAttemptErr) {
        const normalizedFirstAttemptError = Api.internal.normalizeAjaxError(firstAttemptErr, request);
        if (Api.err.isAuthErr(normalizedFirstAttemptError)) { // force refresh token
          request.headers!.Authorization = await Api.internal.googleApiAuthHeader(acctEmail, true);
          try {
            return await $.ajax(request);
          } catch (secondAttemptErr) {
            throw Api.internal.normalizeAjaxError(secondAttemptErr, request);
          }
        }
        throw normalizedFirstAttemptError;
      }
    },
    apiGoogleCall: async (acctEmail: string, method: ReqMethod, url: string, parameters: Dict<Serializable> | string) => {
      const data = method === 'GET' || method === 'DELETE' ? parameters : JSON.stringify(parameters);
      const headers = { Authorization: await Api.internal.googleApiAuthHeader(acctEmail) };
      const request = { url, method, data, headers, crossDomain: true, contentType: 'application/json; charset=UTF-8', async: true };
      return await Api.internal.apiGoogleCallRetryAuthErrorOneTime(acctEmail, request);
    },
    apiGmailCall: async (acctEmail: string, method: ReqMethod, path: string, params: Dict<Serializable> | string | null, progress?: ProgressCbs, contentType?: string) => {
      progress = progress || {};
      let data, url;
      if (typeof progress!.upload === 'function') { // substituted with {} above
        url = 'https://www.googleapis.com/upload/gmail/v1/users/me/' + path + '?uploadType=multipart';
        data = params || undefined;
      } else {
        url = 'https://www.googleapis.com/gmail/v1/users/me/' + path;
        if (method === 'GET' || method === 'DELETE') {
          data = params || undefined;
        } else {
          data = JSON.stringify(params) || undefined;
        }
      }
      contentType = contentType || 'application/json; charset=UTF-8';
      const headers = { 'Authorization': await Api.internal.googleApiAuthHeader(acctEmail) };
      const xhr = () => Api.internal.getAjaxProgressXhr(progress);
      const request = { xhr, url, method, data, headers, crossDomain: true, contentType, async: true };
      return await Api.internal.apiGoogleCallRetryAuthErrorOneTime(acctEmail, request);
    },
    /**
     * oauth token will be valid for another 2 min
     */
    googleApiIsAuthTokenValid: (s: AccountStore) => s.google_token_access && (!s.google_token_expires || s.google_token_expires > new Date().getTime() + (120 * 1000)),
    googleApiAuthHeader: async (acctEmail: string, forceRefresh = false): Promise<string> => {
      if (!acctEmail) {
        throw new Error('missing account_email in api_gmail_call');
      }
      const storage = await Store.getAcct(acctEmail, ['google_token_access', 'google_token_expires', 'google_token_scopes', 'google_token_refresh']);
      if (!storage.google_token_access || !storage.google_token_refresh) {
        throw new Error('Account not connected to FlowCrypt Browser Extension');
      } else if (Api.internal.googleApiIsAuthTokenValid(storage) && !forceRefresh) {
        return `Bearer ${storage.google_token_access}`;
      } else { // refresh token
        const refreshTokenRes = await Api.internal.googleAuthRefreshToken(storage.google_token_refresh);
        await Api.internal.googleAuthCheckAccessToken(refreshTokenRes.access_token); // https://groups.google.com/forum/#!topic/oauth2-dev/QOFZ4G7Ktzg
        await Api.internal.googleAuthSaveTokens(acctEmail, refreshTokenRes, storage.google_token_scopes || []);
        const auth = await Store.getAcct(acctEmail, ['google_token_access', 'google_token_expires']);
        if (Api.internal.googleApiIsAuthTokenValid(auth)) { // have a valid gmail_api oauth token
          return `Bearer ${auth.google_token_access}`;
        } else {
          throw { code: 401, message: 'Could not refresh google auth token - did not become valid', internal: 'auth' };
        }
      }
    },
    apiGoogleAuthPopupPrepareAuthReqScopes: async (acctEmail: string | null, requestedScopes: string[], omitReadScope: boolean): Promise<string[]> => {
      let currentTokensScopes: string[] = [];
      if (acctEmail) {
        const storage = await Store.getAcct(acctEmail, ['google_token_scopes']);
        currentTokensScopes = storage.google_token_scopes || [];
      }
      const authReqScopes = requestedScopes || [];
      for (const scope of Api.GOOGLE_OAUTH2!.scopes) {
        if (!Value.is(scope).in(requestedScopes)) {
          if (scope !== Api.gmail.scope(['read'])[0] || !omitReadScope) { // leave out read messages permission if user chose so
            authReqScopes.push(scope);
          }
        }
      }
      for (const scope of currentTokensScopes) {
        if (!Value.is(scope).in(requestedScopes)) {
          authReqScopes.push(scope);
        }
      }
      return authReqScopes;
    },
    encodeAsMultipartRelated: (parts: Dict<string>) => { // todo - this could probably be achieved with emailjs-mime-builder
      const boundary = 'this_sucks_' + Str.sloppyRandom(10);
      let body = '';
      for (const type of Object.keys(parts)) {
        body += '--' + boundary + '\n';
        body += 'Content-Type: ' + type + '\n';
        if (Value.is('json').in(type as string)) {
          body += '\n' + parts[type] + '\n\n';
        } else {
          body += 'Content-Transfer-Encoding: base64\n';
          body += '\n' + btoa(parts[type]) + '\n\n';
        }
      }
      body += '--' + boundary + '--';
      return { contentType: 'multipart/related; boundary=' + boundary, body };
    },
    apiGmailLoopThroughEmailsToCompileContacts: async (acctEmail: string, query: string, chunkedCb: (r: ProviderContactsResults) => void) => {
      let allResults: Contact[] = [];
      while (true) {
        const headers = await Api.gmail.fetchMsgsBasedOnQueryAndExtractFirstAvailableHeader(acctEmail, query, ['to', 'date']);
        if (headers.to) {
          const rawParsedResults = (window as BrowserWidnow)['emailjs-addressparser'].parse(headers.to);
          const newValidResultPairs = rawParsedResults.filter(r => Str.isEmailValid(r.address));
          const newValidResults = newValidResultPairs.map(r => Store.dbContactObj(r.address, r.name, undefined, undefined, undefined, false, undefined));
          query += rawParsedResults.map(raw => ` -to:"${raw.address}"`).join('');
          allResults = allResults.concat(newValidResults);
          chunkedCb({ new: newValidResults, all: allResults });
          if (query.length > 6000) { // gmail search string can handle about this much
            chunkedCb({ new: [], all: allResults });
            return;
          }
        } else {
          chunkedCb({ new: [], all: allResults });
          return;
        }
      }
    },
    apiGmailFetchMsgsSequentiallyFromListAndExtractFirstAvailableHeader: async (acctEmail: string, messages: R.GmailMsgList$message[], headerNames: string[]): Promise<FlatHeaders> => {
      for (const message of messages) {
        const headerVals: FlatHeaders = {};
        const msgGetRes = await Api.gmail.msgGet(acctEmail, message.id, 'metadata');
        for (const headerName of headerNames) {
          const value = Api.gmail.findHeader(msgGetRes, headerName);
          if (value !== null) {
            headerVals[headerName] = value;
          } else {
            break;
          }
        }
        if (Object.values(headerVals).length === headerNames.length) {
          return headerVals; // all requested header values found in one msg
        }
      }
      return {};
    },
    apiAttesterPacketArmor: (contentText: string) => `${Pgp.armor.headers('attestPacket').begin}\n${contentText}\n${Pgp.armor.headers('attestPacket').end}`,
    apiAttesterCall: (path: string, values: Dict<any>) => Api.internal.apiCall('https://attester.flowcrypt.com/', path, values, 'JSON', undefined, { 'api-version': '3' }),
    apiFcCall: (path: string, vals: Dict<any>, fmt: ReqFmt = 'JSON') => Api.internal.apiCall(Api.fc.url('api'), path, vals, fmt, undefined, { 'api-version': '3' }),
  };

}
