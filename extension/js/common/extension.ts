/* © 2016-2018 FlowCrypt Limited. Limitations apply. Contact human@flowcrypt.com */

'use strict';

import { Str, Value, Dict } from './common.js';
import { Pgp, DiagnoseMsgPubkeysResult, DecryptResult, MsgVerifyResult } from './pgp.js';
import { FlatTypes } from './store.js';
import { Ui, Env, Browser } from './browser.js';
import { Catch } from './catch.js';

type Codec = { encode: (text: string, mode: 'fatal' | 'html') => string, decode: (text: string) => string, labels: string[], version: string };

type PossibleBgExecResults = DecryptResult | DiagnoseMsgPubkeysResult | MsgVerifyResult | string;
type BgExecRequest = { path: string, args: any[] };
type BgExecResponse = { result?: PossibleBgExecResults, exception?: { name: string, message: string, stack: string } };
type BrowserMsgReq = null | Dict<any>;
type BrowserMsgRes = any | Dict<any>;

export type AnyThirdPartyLibrary = any;
export type BrowserMsgReqtDb = { f: string, args: any[] };
export type BrowserMsgReqSessionSet = { acctEmail: string, key: string, value: string | undefined };
export type BrowserMsgReqSessionGet = { acctEmail: string, key: string };
export type BrowserMsgSender = chrome.runtime.MessageSender | 'background';
export type BrowserMsgHandler = (request: BrowserMsgReq, sender: BrowserMsgSender, respond: (r?: any) => void) => void | Promise<void>;

export interface BrowserWidnow extends Window {
  XMLHttpRequest: any;
  onunhandledrejection: (e: any) => void;
  'emailjs-mime-codec': AnyThirdPartyLibrary;
  'emailjs-mime-parser': AnyThirdPartyLibrary;
  'emailjs-mime-builder': AnyThirdPartyLibrary;
  'emailjs-addressparser': {
    parse: (raw: string) => { name: string, address: string }[];
  };
}
export interface FcWindow extends BrowserWidnow {
  $: JQuery;
  iso88592: Codec;
  // windows1252: Codec;
  // koi8r: Codec;
  is_bare_engine: boolean;
}
export interface ContentScriptWindow extends FcWindow {
  TrySetDestroyableTimeout: (code: () => void, ms: number) => number;
  TrySetDestroyableInterval: (code: () => void, ms: number) => number;
  injected: true; // background script will use this to test if scripts were already injected, and inject if not
  account_email_global: null | string; // used by background script
  same_world_global: true; // used by background_script
  destruction_event: string;
  destroyable_class: string;
  reloadable_class: string;
  destroyable_intervals: number[];
  destroyable_timeouts: number[];
  destroy: () => void;
  vacant: () => boolean;
}
export interface FlowCryptManifest extends chrome.runtime.Manifest {
  oauth2: { client_id: string, url_code: string, url_tokens: string, url_redirect: string, state_header: string, scopes: string[] };
}

export class TabIdRequiredError extends Error { }

export class Extension { // todo - move extension-specific common.js code here

  public static prepareBugReport = (name: string, details?: Dict<FlatTypes>, error?: Error | any): string => {
    let bugReport: Dict<string> = {
      name,
      stack: Catch.stackTrace(),
    };
    try {
      bugReport.error = JSON.stringify(error, null, 2);
    } catch (e) {
      bugReport.error_as_string = String(error);
      bugReport.error_serialization_error = String(e);
    }
    try {
      bugReport.details = JSON.stringify(details, null, 2);
    } catch (e) {
      bugReport.details_as_string = String(details);
      bugReport.details_serialization_error = String(e);
    }
    let result = '';
    for (let k of Object.keys(bugReport)) {
      result += `\n[${k}]\n${bugReport[k]}\n`;
    }
    return result;
  }

}

export class BrowserMsg {

  public static MAX_SIZE = 1024 * 1024; // 1MB
  private static HANDLERS_REGISTERED_BACKGROUND: Dict<BrowserMsgHandler> | null = null;
  private static HANDLERS_REGISTERED_FRAME: Dict<BrowserMsgHandler> = {};
  private static HANDLERS_STANDARD = {
    set_css: (data: { css: Dict<string | number>, selector: string, traverse_up?: number }) => {
      let el = $(data.selector);
      let traverseUpLevels = data.traverse_up as number || 0;
      for (let i = 0; i < traverseUpLevels; i++) {
        el = el.parent();
      }
      el.css(data.css);
    },
  } as Dict<BrowserMsgHandler>;

  public static send = (destString: string | null, name: string, data: Dict<any> | null = null) => {
    BrowserMsg.sendAwait(destString, name, data).catch(Catch.rejection);
  }

  public static sendAwait = (destString: string | null, name: string, data: Dict<any> | null = null): Promise<BrowserMsgRes> => new Promise(resolve => {
    let msg = { name, data, to: destString || null, uid: Str.random(10), stack: Catch.stackTrace() };
    let tryResolveNoUndefined = (r?: BrowserMsgRes) => Catch.try(() => resolve(typeof r === 'undefined' ? {} : r))();
    let isBackgroundPage = Env.isBackgroundPage();
    if (typeof destString === 'undefined') { // don't know where to send the message
      Catch.log('BrowserMsg.send to:undefined');
      tryResolveNoUndefined();
    } else if (isBackgroundPage && BrowserMsg.HANDLERS_REGISTERED_BACKGROUND && msg.to === null) {
      BrowserMsg.HANDLERS_REGISTERED_BACKGROUND[msg.name](msg.data, 'background', tryResolveNoUndefined); // calling from background script to background script: skip messaging completely
    } else if (isBackgroundPage) {
      chrome.tabs.sendMessage(BrowserMsg.browserMsgDestParse(msg.to).tab!, msg, {}, tryResolveNoUndefined);
    } else {
      chrome.runtime.sendMessage(msg, tryResolveNoUndefined);
    }
  })

  public static tabId = async (): Promise<string | null | undefined> => {
    let r = await BrowserMsg.sendAwait(null, '_tab_', null);
    if (typeof r === 'string' || typeof r === 'undefined' || r === null) {
      return r; // for compatibility reasons when upgrading from 5.7.2 - can be removed later
    } else {
      return r.tabId; // new format
    }
  }

  public static requiredTabId = async (): Promise<string> => {
    let tabId;
    for (let i = 0; i < 10; i++) { // up to 10 attempts. Sometimes returns undefined right after browser start
      tabId = await BrowserMsg.tabId();
      if (tabId) {
        return tabId;
      }
      await Ui.time.sleep(200); // sleep 200ms between attempts
    }
    throw new TabIdRequiredError(`Tab id is required, but received '${String(tabId)}' after 10 attempts`);
  }

  public static listen = (handlers: Dict<BrowserMsgHandler>, listenForFabId = 'all') => {
    for (let name of Object.keys(handlers)) {
      // newly registered handlers with the same name will overwrite the old ones if BrowserMsg.listen is declared twice for the same frame
      // original handlers not mentioned in newly set handlers will continue to work
      BrowserMsg.HANDLERS_REGISTERED_FRAME[name] = handlers[name];
    }
    for (let name of Object.keys(BrowserMsg.HANDLERS_STANDARD)) {
      if (typeof BrowserMsg.HANDLERS_REGISTERED_FRAME[name] !== 'function') {
        BrowserMsg.HANDLERS_REGISTERED_FRAME[name] = BrowserMsg.HANDLERS_STANDARD[name]; // standard handlers are only added if not already set above
      }
    }
    let processed: string[] = [];
    chrome.runtime.onMessage.addListener((msg, sender, respond) => {
      try {
        if (msg.to === listenForFabId || msg.to === 'broadcast') {
          if (!Value.is(msg.uid).in(processed)) {
            processed.push(msg.uid);
            if (typeof BrowserMsg.HANDLERS_REGISTERED_FRAME[msg.name] !== 'undefined') {
              let r = BrowserMsg.HANDLERS_REGISTERED_FRAME[msg.name](msg.data, sender, respond);
              if (r && typeof r === 'object' && (r as Promise<void>).then && (r as Promise<void>).catch) {
                // todo - a way to callback the error to be re-thrown to caller stack
                (r as Promise<void>).catch(Catch.rejection);
              }
            } else if (msg.name !== '_tab_' && msg.to !== 'broadcast') {
              if (BrowserMsg.browserMsgDestParse(msg.to).frame !== null) {
                // only consider it an error if frameId was set because of firefox bug: https://bugzilla.mozilla.org/show_bug.cgi?id=1354337
                Catch.report('BrowserMsg.listen error: handler "' + msg.name + '" not set', 'Message sender stack:\n' + msg.stack);
              } else { // once firefox fixes the bug, it will behave the same as Chrome and the following will never happen.
                console.log('BrowserMsg.listen ignoring missing handler "' + msg.name + '" due to Firefox Bug');
              }
            }
          }
        }
        return !!respond; // indicate that this listener intends to respond
      } catch (e) {
        // todo - a way to callback the error to be re-thrown to caller stack
        Catch.handleException(e);
      }
    });
  }

  public static listenBg = (handlers: Dict<BrowserMsgHandler>) => {
    if (!BrowserMsg.HANDLERS_REGISTERED_BACKGROUND) {
      BrowserMsg.HANDLERS_REGISTERED_BACKGROUND = handlers;
    } else {
      for (let name of Object.keys(handlers)) {
        BrowserMsg.HANDLERS_REGISTERED_BACKGROUND[name] = handlers[name];
      }
    }
    chrome.runtime.onMessage.addListener((msg, sender, respond) => {
      try {
        let safeRespond = (response: any) => {
          try { // avoiding unnecessary errors when target tab gets closed
            respond(response);
          } catch (e) {
            // todo - the sender should still know - could have PageClosedError
            if (e.message !== 'Attempting to use a disconnected port object') {
              Catch.handleException(e);
              throw e;
            }
          }
        };
        if (msg.to && msg.to !== 'broadcast') {
          msg.sender = sender;
          chrome.tabs.sendMessage(BrowserMsg.browserMsgDestParse(msg.to).tab!, msg, {}, safeRespond);
        } else if (Value.is(msg.name).in(Object.keys(BrowserMsg.HANDLERS_REGISTERED_BACKGROUND!))) { // is !null because added above
          let r = BrowserMsg.HANDLERS_REGISTERED_BACKGROUND![msg.name](msg.data, sender, safeRespond); // is !null because checked above
          if (r && typeof r === 'object' && (r as Promise<void>).then && (r as Promise<void>).catch) {
            // todo - a way to callback the error to be re-thrown to caller stack
            (r as Promise<void>).catch(Catch.rejection);
          }
        } else if (msg.to !== 'broadcast') {
          Catch.report('BrowserMsg.listen_background error: handler "' + msg.name + '" not set', 'Message sender stack:\n' + msg.stack);
        }
        return !!respond; // indicate that we intend to respond later
      } catch (e) {
        // todo - a way to callback the error to be re-thrown to caller stack
        Catch.handleException(e);
      }
    });
  }

  private static browserMsgDestParse = (destString: string | null) => {
    let parsed = { tab: null as null | number, frame: null as null | number };
    if (destString) {
      parsed.tab = Number(destString.split(':')[0]);
      // @ts-ignore - adding nonsense into isNaN
      parsed.frame = !isNaN(destString.split(':')[1]) ? Number(destString.split(':')[1]) : null;
    }
    return parsed;
  }

}

export class BgExec {

  private static MAX_MESSAGE_SIZE = 1024 * 1024;

  public static bgReqHandler: BrowserMsgHandler = async (message: BgExecRequest, sender, respond: (r: BgExecResponse) => void) => {
    try {
      let argPromises = BgExec.argObjUrlsConsume(message.args);
      let args = await Promise.all(argPromises);
      let result = await BgExec.executeAndFormatResult(message.path, args);
      respond({ result });
    } catch (e) {
      try {
        respond({
          exception: {
            name: e.constructor.name,
            message: e.message,
            stack: (e.stack || '') + ((e as any).workerStack ? `\n\nWorker stack:\n${(e as any).workerStack}` : ''),
          },
        });
      } catch (e2) {
        respond({
          exception: {
            name: `CANNOT_PROCESS_BG_EXEC_ERROR: ${String(e2)}`,
            message: String(e),
            stack: new Error().stack!,
          },
        });
      }
    }
  }

  public static diagnoseMsgPubkeys = (acctEmail: string, message: string) => {
    return BgExec.requestToProcessInBg('Pgp.msg.diagnosePubkeys', [acctEmail, message]) as Promise<DiagnoseMsgPubkeysResult>;
  }

  public static cryptoHashChallengeAnswer = (password: string) => {
    return BgExec.requestToProcessInBg('Pgp.hash.challengeAnswer', [password]) as Promise<string>;
  }

  public static cryptoMsgDecrypt = async (acctEmail: string, encryptedData: string | Uint8Array, msgPwd: string | null = null, getUint8 = false) => {
    let result = await BgExec.requestToProcessInBg('Pgp.msg.decrypt', [acctEmail, encryptedData, msgPwd, getUint8]) as DecryptResult;
    if (result.success && result.content && result.content.blob && result.content.blob.blob_url.indexOf(`blob:${chrome.runtime.getURL('')}`) === 0) {
      if (result.content.blob.blob_type === 'text') {
        result.content.text = Str.fromUint8(await Browser.objUrlConsume(result.content.blob.blob_url));
      } else {
        result.content.uint8 = await Browser.objUrlConsume(result.content.blob.blob_url);
      }
      result.content.blob = undefined;
    }
    return result;
  }

  public static cryptoMsgVerifyDetached = (acctEmail: string, message: string | Uint8Array, signature: string | Uint8Array) => {
    return BgExec.requestToProcessInBg('Pgp.msg.verifyDetached', [acctEmail, message, signature]) as Promise<MsgVerifyResult>;
  }

  private static executeAndFormatResult = async (path: string, resolvedArgs: any[]): Promise<PossibleBgExecResults> => {
    let f = BgExec.resolvePathToCallableFunction(path);
    let returned: Promise<PossibleBgExecResults> | PossibleBgExecResults = f.apply(null, resolvedArgs);
    if (returned && typeof returned === 'object' && typeof (returned as Promise<PossibleBgExecResults>).then === 'function') { // got a promise
      let resolved = await returned;
      if (path === 'Pgp.msg.decrypt') {
        BgExec.cryptoMsgDecryptResCreateBlobs(resolved as DecryptResult);
      }
      return resolved;
    }
    return returned as PossibleBgExecResults; // direct result
  }

  private static cryptoMsgDecryptResCreateBlobs = (decryptRes: DecryptResult) => {
    if (decryptRes && decryptRes.success && decryptRes.content) {
      if (decryptRes.content.text && decryptRes.content.text.length >= BgExec.MAX_MESSAGE_SIZE) {
        decryptRes.content.blob = { blob_type: 'text', blob_url: Browser.objUrlCreate(decryptRes.content.text) };
        decryptRes.content.text = undefined; // replaced with a blob
      } else if (decryptRes.content.uint8 && decryptRes.content.uint8 instanceof Uint8Array) {
        decryptRes.content.blob = { blob_type: 'uint8', blob_url: Browser.objUrlCreate(decryptRes.content.uint8) };
        decryptRes.content.uint8 = undefined; // replaced with a blob
      }
    }
  }

  private static isObjUrl = (arg: any) => typeof arg === 'string' && arg.indexOf('blob:' + chrome.runtime.getURL('')) === 0;

  private static shouldBeObjUrl = (arg: any) => (typeof arg === 'string' && arg.length > BrowserMsg.MAX_SIZE) || arg instanceof Uint8Array;

  private static argObjUrlsConsume = (args: any[]) => args.map((arg: any) => BgExec.isObjUrl(arg) ? Browser.objUrlConsume(arg) : arg);

  private static argObjUrlsCreate = (args: any[]) => args.map(arg => BgExec.shouldBeObjUrl(arg) ? Browser.objUrlCreate(arg) : arg);

  private static resolvePathToCallableFunction = (path: string): Function => {  // tslint:disable-line:ban-types
    let f: Function | object | null = null; // tslint:disable-line:ban-types
    for (let step of path.split('.')) {
      if (f === null) {
        if (step === 'Pgp') {
          f = Pgp;
        } else {
          throw new Error(`BgExec: Not prepared for relaying class ${step}`);
        }
      } else {
        // @ts-ignore
        f = f[step];
      }
    }
    return f as Function; // tslint:disable-line:ban-types
  }

  private static requestToProcessInBg = async (path: string, args: any[]) => {
    let response: BgExecResponse = await BrowserMsg.sendAwait(null, 'bg_exec', { path, args: BgExec.argObjUrlsCreate(args) });
    if (response.exception) {
      let e = new Error(`[BgExec] ${response.exception.name}: ${response.exception.message}`);
      e.stack += `\n\nBgExec stack:\n${response.exception.stack}`;
      throw e;
    }
    return response.result!;
  }

}
