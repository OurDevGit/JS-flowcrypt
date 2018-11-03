/* © 2016-2018 FlowCrypt Limited. Limitations apply. Contact human@flowcrypt.com */

/// <reference path="../../../node_modules/@types/chrome/index.d.ts" />

'use strict';

import * as DOMPurify from 'dompurify';
import {Store, FlatTypes, Serializable, KeyInfo} from './storage.js';
import {XssSafeFactory} from './factory.js';
import * as t from '../../types/common';
import { Api, ProgressCallback } from './api.js';
import { Pgp } from './pgp.js';

declare let $_HOST_html_to_text: (html: string) => string;
declare const openpgp: typeof OpenPGP;

export class UnreportableError extends Error {}
export class TabIdRequiredError extends Error {}

export class Attachment {

  private text: string|null = null;
  private bytes: Uint8Array|null = null;
  private treat_as_value: t.Attachment$treat_as|null = null;

  public length: number;
  public type: string;
  public name: string;
  public url: string|null;
  public id: string|null;
  public message_id: string|null;
  public inline: boolean;
  public cid: string|null;

  constructor({data, type, name, length, url, inline, id, message_id, treat_as, cid}: t.AttachmentMeta) {
    if(typeof data === 'undefined' && typeof url === 'undefined' && typeof id === 'undefined') {
      throw new Error('Attachment: one of data|url|id has to be set');
    }
    if(id && !message_id) {
      throw new Error('Attachment: if id is set, message_id must be set too');
    }
    if(data !== null && typeof data !== 'undefined') {
      this.set_data(data);
    }
    this.name = name || '';
    this.type = type || 'application/octet-stream';
    this.length = data ? data.length : (length || NaN);
    this.url = url || null;
    this.inline = inline !== true;
    this.id = id || null;
    this.message_id = message_id || null;
    this.treat_as_value = treat_as || null;
    this.cid = cid || null;
  }

  public set_data = (data: string|Uint8Array) => {
    if(this.has_data()) {
      throw new Error('Attachment: data already set');
    }
    if(data instanceof Uint8Array) {
      this.bytes = data;
    } else if(typeof data === 'string') {
      this.text = data;
    }
    this.length = data.length;
  }

  public has_data = () => {
    if(this.bytes === null && this.text === null) {
      return false;
    }
    return true;
  }

  public data = (): string|Uint8Array => {
    if(this.bytes !== null) {
      return this.bytes;
    }
    if (this.text !== null) {
      return this.text;
    }
    throw new Error('Attachment has no data set');
  }

  public as_text = (): string => {
    if(this.text === null && this.bytes !== null) {
      this.text = Str.from_uint8(this.bytes);
    }
    if(this.text !== null) {
      return this.text;
    }
    throw new Error('Attachment has no data set');
  }

  public as_bytes = (): Uint8Array => {
    if(this.bytes === null && this.text !== null) {
      this.bytes = Str.to_uint8(this.text);
    }
    if (this.bytes !== null) {
      return this.bytes;
    }
    throw new Error('Attachment has no data set');
  }

  public treat_as = (): t.Attachment$treat_as => {
    // todo - should return a probability in the range of certain-likely-maybe
    // could also return possible types as an array - which makes basic usage more difficult - to think through
    // better option - add an "unknown" type: when encountered, code consuming this should inspect a chunk of contents
    if(this.treat_as_value) { // pre-set
      return this.treat_as_value;
    } else if (Value.is(this.name).in(['PGPexch.htm.pgp', 'PGPMIME version identification', 'Version.txt'])) {
      return 'hidden';  // PGPexch.htm.pgp is html alternative of textual body content produced by PGP Desktop and GPG4o
    } else if (this.name === 'signature.asc' || this.type === 'application/pgp-signature') {
      return  'signature';
    } else if (!this.name && !Value.is('image/').in(this.type)) { // this.name may be '' or undefined - catch either
      return this.length < 100 ? 'hidden' : 'message';
    } else if (Value.is(this.name).in(['message', 'msg.asc', 'message.asc', 'encrypted.asc', 'encrypted.eml.pgp', 'Message.pgp'])) {
      return 'message';
    } else if (this.name.match(/(\.pgp$)|(\.gpg$)|(\.[a-zA-Z0-9]{3,4}\.asc$)/g)) { // ends with one of .gpg, .pgp, .???.asc, .????.asc
      return 'encrypted';
    } else if (this.name.match(/^(0|0x)?[A-F0-9]{8}([A-F0-9]{8})?.*\.asc$/g)) { // name starts with a key id
      return 'public_key';
    } else if (Value.is('public').in(this.name.toLowerCase()) && this.name.match(/[A-F0-9]{8}.*\.asc$/g)) { // name contains the word "public", any key id and ends with .asc
      return 'public_key';
    } else if (this.name.match(/\.asc$/) && this.length < 100000 && !this.inline) {
      return 'message';
    } else {
      return 'standard';
    }
  }

  public static methods = {
    object_url_create: (content: Uint8Array|string) => window.URL.createObjectURL(new Blob([content], { type: 'application/octet-stream' })),
    object_url_consume: async (url: string) => {
      let uint8 = await Attachment.methods.download_as_uint8(url, null);
      window.URL.revokeObjectURL(url);
      return uint8;
    },
    download_as_uint8: (url: string, progress:ProgressCallback|null=null): Promise<Uint8Array> => new Promise((resolve, reject) => {
      let request = new XMLHttpRequest();
      request.open('GET', url, true);
      request.responseType = 'arraybuffer';
      if (typeof progress === 'function') {
        request.onprogress = (evt) => progress(evt.lengthComputable ? Math.floor((evt.loaded / evt.total) * 100) : null, evt.loaded, evt.total);
      }
      request.onerror = reject;
      request.onload = e => resolve(new Uint8Array(request.response));
      request.send();
    }),
    save_to_downloads: (attachment: Attachment, render_in:JQuery<HTMLElement>|null=null) => {
      let blob = new Blob([attachment.data()], {type: attachment.type});
      if (window.navigator && window.navigator.msSaveOrOpenBlob) {
        window.navigator.msSaveBlob(blob, attachment.name);
      } else {
        let a = window.document.createElement('a');
        a.href = window.URL.createObjectURL(blob);
        a.download = Xss.html_escape(attachment.name);
        if (render_in) {
          a.textContent = 'DECRYPTED FILE';
          a.style.cssText = 'font-size: 16px; font-weight: bold;';
          Xss.sanitize_render(render_in, '<div style="font-size: 16px;padding: 17px 0;">File is ready.<br>Right-click the link and select <b>Save Link As</b></div>');
          render_in.append(a); // xss-escaped attachment name above
          render_in.css('height', 'auto');
          render_in.find('a').click(e => {
            alert('Please use right-click and select Save Link As');
            e.preventDefault();
            e.stopPropagation();
            return false;
          });
        } else {
          if (typeof a.click === 'function') {
            a.click();
          } else { // safari
            let e = document.createEvent('MouseEvents');
            // @ts-ignore - safari only. expected 15 arguments, but works well with 4
            e.initMouseEvent('click', true, true, window);
            a.dispatchEvent(e);
          }
          if (Env.browser().name === 'firefox') {
            try {
              document.body.removeChild(a);
            } catch (err) {
              if (err.message !== 'Node was not found') {
                throw err;
              }
            }
          }
          Catch.set_timeout(() => window.URL.revokeObjectURL(a.href), 0);
        }
      }
    },
    pgp_name_patterns: () => ['*.pgp', '*.gpg', '*.asc', 'noname', 'message', 'PGPMIME version identification', ''],
    keyinfo_as_pubkey_attachment: (ki: KeyInfo) => new Attachment({data: ki.public, type: 'application/pgp-keys', name: `0x${ki.longid}.asc`}),
  };

}

export class Extension { // todo - move extension-specific common.js code here

  public static prepare_bug_report = (name: string, details?: t.Dict<FlatTypes>, error?: Error|any): string => {
    let bug_report: t.Dict<string> = {
      name,
      stack: Catch.stack_trace(),
    };
    try {
      bug_report.error = JSON.stringify(error, null, 2);
    } catch(e) {
      bug_report.error_as_string = String(error);
      bug_report.error_serialization_error = String(e);
    }
    try {
      bug_report.details = JSON.stringify(details, null, 2);
    } catch(e) {
      bug_report.details_as_string = String(details);
      bug_report.details_serialization_error = String(e);
    }
    let result = '';
    for(let k of Object.keys(bug_report)) {
      result += `\n[${k}]\n${bug_report[k]}\n`;
    }
    return result;
  }

}

export class Env {

  private static URL_PARAM_DICT: t.Dict<boolean|null> = {'___cu_true___': true, '___cu_false___': false, '___cu_null___': null};

  public static browser = () => {  // http://stackoverflow.com/questions/4825498/how-can-i-find-out-which-browser-a-user-is-using
    if (/Firefox[\/\s](\d+\.\d+)/.test(navigator.userAgent)) {
      return {name: 'firefox', v: Number(RegExp.$1)};
    } else if (/MSIE (\d+\.\d+);/.test(navigator.userAgent)) {
      return {name: 'ie', v: Number(RegExp.$1)};
    } else if (/Chrome[\/\s](\d+\.\d+)/.test(navigator.userAgent)) {
      return {name: 'chrome', v: Number(RegExp.$1)};
    } else if (/Opera[\/\s](\d+\.\d+)/.test(navigator.userAgent)) {
      return {name: 'opera', v: Number(RegExp.$1)};
    } else if (/Safari[\/\s](\d+\.\d+)/.test(navigator.userAgent)) {
      return {name: 'safari', v: Number(RegExp.$1)};
    } else {
      return {name: 'unknown', v: null};
    }
  }

  public static runtime_id = (original=false) => {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
      if (original === true) {
        return chrome.runtime.id;
      } else {
        return chrome.runtime.id.replace(/[^a-z0-9]/gi, '');
      }
    }
    return null;
  }

  public static is_background_page = () => Boolean(window.location && Value.is('background_page.htm').in(window.location.href));

  public static is_extension = () => Env.runtime_id() !== null;

  public static url_param_require = {
    string: (values: t.UrlParams, name: string): string => Ui.abort_and_render_error_on_url_param_type_mismatch(values, name, 'string') as string,
    oneof: (values: t.UrlParams, name: string, allowed: t.UrlParam[]): string => Ui.abort_and_render_error_on_url_param_value_mismatch(values, name, allowed) as string,
  };

  public static url_params = (expected_keys: string[], string:string|null=null) => {
    let url = (string || window.location.search.replace('?', ''));
    let value_pairs = url.split('?').pop()!.split('&'); // str.split('?') string[].length will always be >= 1
    let url_data: t.UrlParams = {};
    for (let value_pair of value_pairs) {
      let pair = value_pair.split('=');
      if (Value.is(pair[0]).in(expected_keys)) {
        url_data[pair[0]] = typeof Env.URL_PARAM_DICT[pair[1]] !== 'undefined' ? Env.URL_PARAM_DICT[pair[1]] : decodeURIComponent(pair[1]);
      }
    }
    return url_data;
  }

  public static url_create = (link: string, params: t.UrlParams) => {
    for (let key of Object.keys(params)) {
      let value = params[key];
      if (typeof value !== 'undefined') {
        let transformed = Value.obj.key_by_value(Env.URL_PARAM_DICT, value);
        link += (!Value.is('?').in(link) ? '?' : '&') + encodeURIComponent(key) + '=' + encodeURIComponent(String(typeof transformed !== 'undefined' ? transformed : value));
      }
    }
    return link;
  }

  public static key_codes = () => {
    return { a: 97, r: 114, A: 65, R: 82, f: 102, F: 70, backspace: 8, tab: 9, enter: 13, comma: 188, };
  }

  public static webmails = async (): Promise<t.WebMailName[]> => {
    return ['gmail', 'inbox']; // async because storage may be involved in the future
  }

}

export class Ui {

  public static EVENT_DOUBLE_MS = 1000;
  public static EVENT_SPREE_MS = 50;
  public static EVENT_SLOW_SPREE_MS = 200;
  public static EVENT_VERY_SLOW_SPREE_MS = 500;

  public static retry_link = (caption:string='retry') => `<a href="${Xss.html_escape(window.location.href)}">${Xss.html_escape(caption)}</a>`;

  public static delay = (ms: number) => new Promise(resolve => Catch.set_timeout(resolve, ms));

  public static spinner = (color: string, placeholder_class:"small_spinner"|"large_spinner"='small_spinner') => {
    let path = `/img/svgs/spinner-${color}-small.svg`;
    let url = typeof chrome !== 'undefined' && chrome.extension && chrome.extension.getURL ? chrome.extension.getURL(path) : path;
    return `<i class="${placeholder_class}" data-test="spinner"><img src="${url}" /></i>`;
  }

  public static render_overlay_prompt_await_user_choice = (buttons: t.Dict<{title?: string, color?: string}>, prompt: string): Promise<string> => {
    return new Promise(resolve => {
      let btns = Object.keys(buttons).map(id => `<div class="button ${Xss.html_escape(buttons[id].color || 'green')} overlay_action_${Xss.html_escape(id)}">${Xss.html_escape(buttons[id].title || id.replace(/_/g, ' '))}</div>`).join('&nbsp;'.repeat(5));
      Xss.sanitize_append('body', `
        <div class="featherlight white prompt_overlay" style="display: block;">
          <div class="featherlight-content" data-test="dialog">
            <div class="line">${prompt.replace(/\n/g, '<br>')}</div>
            <div class="line">${btns}</div>
            <div class="line">&nbsp;</div>
            <div class="line">Email human@flowcrypt.com if you need assistance.</div>
          </div>
        </div>
      `);
      let overlay = $('.prompt_overlay');
      for(let id of Object.keys(buttons)) {
        overlay.find(`.overlay_action_${id}`).one('click', () => {
          overlay.remove();
          resolve(id);
        });
      }
    });
  }

  public static abort_and_render_error_on_unprotected_key = async (account_email?: string, tab_id?: string) => {
    if(account_email) {
      let [primary_ki] = await Store.keys_get(account_email, ['primary']);
      let {setup_done, setup_simple} = await Store.get_account(account_email, ['setup_simple', 'setup_done']);
      if(setup_done && setup_simple && primary_ki && openpgp.key.readArmored(primary_ki.private).keys[0].isDecrypted()) {
        if(window.location.pathname === '/chrome/settings/index.htm') {
          // @ts-ignore - this lets it compile in content script that is missing Settings
          Settings.render_sub_page(account_email, tab_id!, '/chrome/settings/modules/change_passphrase.htm');
        } else {
          let msg = `Protect your key with a pass phrase to finish setup.`;
          let r = await Ui.render_overlay_prompt_await_user_choice({finish_setup: {}, later: {color: 'gray'}}, msg);
          if(r === 'finish_setup') {
            BrowserMsg.send(null, 'settings', {account_email});
          }
        }
      }
    }
  }

  public static abort_and_render_error_on_url_param_type_mismatch = (values: t.UrlParams, name: string, expected_type: string): t.UrlParam => {
    let actual_type = typeof values[name];
    if (actual_type !== expected_type) {
      let msg = `Cannot render page (expected ${Xss.html_escape(name)} to be of type ${Xss.html_escape(expected_type)} but got ${Xss.html_escape(actual_type)})<br><br>Was the URL editted manually? Please write human@flowcrypt.com for help.`;
      Xss.sanitize_render('body', msg).addClass('bad').css({padding: '20px', 'font-size': '16px'});
      throw new UnreportableError(msg);
    }
    return values[name];
  }

  public static abort_and_render_error_on_url_param_value_mismatch = <T>(values: t.Dict<T>, name: string, expected_values: T[]): T => {
    if (expected_values.indexOf(values[name]) === -1) {
      let msg = `Cannot render page (expected ${Xss.html_escape(name)} to be one of ${Xss.html_escape(expected_values.map(String).join(','))} but got ${Xss.html_escape(String(values[name]))}<br><br>Was the URL editted manually? Please write human@flowcrypt.com for help.`;
      Xss.sanitize_render('body', msg).addClass('bad').css({padding: '20px', 'font-size': '16px'});
      throw new UnreportableError(msg);
    }
    return values[name];
  }

  public static passphrase_toggle = async (pass_phrase_input_ids: string[], force_initial_show_or_hide:"show"|"hide"|null=null) => {
    let button_hide = '<img src="/img/svgs/eyeclosed-icon.svg" class="eye-closed"><br>hide';
    let button_show = '<img src="/img/svgs/eyeopen-icon.svg" class="eye-open"><br>show';
    let {hide_pass_phrases} = await Store.get_global(['hide_pass_phrases']);
    let show: boolean;
    if (force_initial_show_or_hide === 'hide') {
      show = false;
    } else if (force_initial_show_or_hide === 'show') {
      show = true;
    } else {
      show = !hide_pass_phrases;
    }
    for (let id of pass_phrase_input_ids) {
      let passphrase_input = $('#' + id);
      passphrase_input.addClass('toggled_passphrase');
      if (show) {
        passphrase_input.after('<label href="#" id="toggle_' + id + '" class="toggle_show_hide_pass_phrase" for="' + id + '">' + button_hide + '</label>');
        passphrase_input.attr('type', 'text');
      } else {
        passphrase_input.after('<label href="#" id="toggle_' + id + '" class="toggle_show_hide_pass_phrase" for="' + id + '">' + button_show + '</label>');
        passphrase_input.attr('type', 'password');
      }
      $('#toggle_' + id).click(Ui.event.handle(target => {
        if (passphrase_input.attr('type') === 'password') {
          $('#' + id).attr('type', 'text');
          Xss.sanitize_render(target, button_hide);
          Store.set(null, { hide_pass_phrases: false }).catch(Catch.rejection);
        } else {
          $('#' + id).attr('type', 'password');
          Xss.sanitize_render(target, button_show);
          Store.set(null, { hide_pass_phrases: true }).catch(Catch.rejection);
        }
      }));
    }
  }

  public static enter = (callback: () => void) => (e: JQuery.Event<HTMLElement, null>) => { // returns a function
    if (e.which === Env.key_codes().enter) {
      callback();
    }
  }

  public static build_jquery_selectors = (selectors: t.Dict<string>): t.SelectorCache => {
    let cache: t.NamedSelectors = {};
    return {
      cached: (name: string) => {
        if (!cache[name]) {
          if (typeof selectors[name] === 'undefined') {
            Catch.report('unknown selector name: ' + name);
          }
          cache[name] = $(selectors[name]);
        }
        return cache[name];
      },
      now: (name: string) => {
        if (typeof selectors[name] === 'undefined') {
          Catch.report('unknown selector name: ' + name);
        }
        return $(selectors[name]);
      },
      selector: (name: string) => {
        if (typeof selectors[name] === 'undefined') {
          Catch.report('unknown selector name: ' + name);
        }
        return selectors[name];
      }
    };
  }

  public static scroll = (selector: string|JQuery<HTMLElement>, repeat:number[]=[]) => {
    let el = $(selector as string).first()[0]; // as string due to JQuery TS quirk
    if (el) {
      el.scrollIntoView();
      for (let delay of repeat) { // useful if mobile keyboard is about to show up
        Catch.set_timeout(() => el.scrollIntoView(), delay);
      }
    }
  }

  public static event = {
    clicked: (selector: string): Promise<HTMLElement> => new Promise(resolve => $(selector).one('click', function() { resolve(this); })),
    stop: () => (e: JQuery.Event) => { // returns a function
      e.preventDefault();
      e.stopPropagation();
      return false;
    },
    protect: () => {
      // prevent events that could potentially leak information about sensitive info from bubbling above the frame
      $('body').on('keyup keypress keydown click drag drop dragover dragleave dragend submit', e => {
        // don't ask me how come Chrome allows it to bubble cross-domain
        // should be used in embedded frames where the parent cannot be trusted (eg parent is webmail)
        // should be further combined with iframe type=content + sandboxing, but these could potentially be changed by the parent frame
        // so this indeed seems like the only defense
        // happened on only one machine, but could potentially happen to other users as well
        // if you know more than I do about the hows and whys of events bubbling out of iframes on different domains, let me know
        e.stopPropagation();
      });
    },
    handle: (cb: (e: HTMLElement, event: JQuery.Event<HTMLElement, null>) => void|Promise<void>, err_handler?: t.BrowserEventErrorHandler) => {
      return function(event: JQuery.Event<HTMLElement, null>) {
        let r;
        try {
          r = cb(this, event);
          if(typeof r === 'object' && typeof r.catch === 'function') {
            r.catch(e => Ui.event.__dispatch_err(e, err_handler));
          }
        } catch(e) {
          Ui.event.__dispatch_err(e, err_handler);
        }
      };
    },
    __dispatch_err: (e: any, err_handler?: t.BrowserEventErrorHandler) => {
      if(Api.error.is_network_error(e) && err_handler && err_handler.network) {
        err_handler.network();
      } else if (Api.error.is_auth_error(e) && err_handler && err_handler.auth) {
        err_handler.auth();
      } else if (Api.error.is_auth_popup_needed(e) && err_handler && err_handler.auth_popup) {
        err_handler.auth_popup();
      } else if (err_handler && err_handler.other) {
        err_handler.other(e);
      } else {
        Catch.handle_exception(e);
      }
    },
    prevent: (preventable_event: t.PreventableEventName, cb: (e: HTMLElement, reset_timer: () => void) => void|Promise<void>, err_handler?: t.BrowserEventErrorHandler) => {
      let event_timer: number|undefined;
      let event_fired_on: number|undefined;
      let cb_reset_timer = () => {
        event_timer = undefined;
        event_fired_on = undefined;
      };
      let cb_with_errors_handled = (e: HTMLElement) => {
        let r;
        try {
          r = cb(e, cb_reset_timer);
          if(typeof r === 'object' && typeof r.catch === 'function') {
            r.catch(e => Ui.event.__dispatch_err(e, err_handler));
          }
        } catch(e) {
          Ui.event.__dispatch_err(e, err_handler);
        }
      };
      return function() {
        if (preventable_event === 'spree') {
          clearTimeout(event_timer);
          event_timer = Catch.set_timeout(() => cb_with_errors_handled(this), Ui.EVENT_SPREE_MS);
        } else if (preventable_event === 'slowspree') {
          clearTimeout(event_timer);
          event_timer = Catch.set_timeout(() => cb_with_errors_handled(this), Ui.EVENT_SLOW_SPREE_MS);
        } else if (preventable_event === 'veryslowspree') {
          clearTimeout(event_timer);
          event_timer = Catch.set_timeout(() => cb_with_errors_handled(this), Ui.EVENT_VERY_SLOW_SPREE_MS);
        } else {
          if (event_fired_on) {
            if (preventable_event === 'parallel') {
              // event handling is still being processed. Do not call back
            } else if (preventable_event === 'double') {
              if (Date.now() - event_fired_on > Ui.EVENT_DOUBLE_MS) {
                event_fired_on = Date.now();
                cb_with_errors_handled(this);
              }
            }
          } else {
            event_fired_on = Date.now();
            cb_with_errors_handled(this);
          }
        }
      };
    }
  };

  /**
   * XSS WARNING
   *
   * Return values are inserted directly into DOM. Results must be html escaped.
   *
   * When edited, REQUEST A SECOND SET OF EYES TO REVIEW CHANGES
   */
  public static renderable_message_block = (factory: XssSafeFactory, block: t.MessageBlock, message_id:string|null=null, sender_email:string|null=null, is_outgoing: boolean|null=null) => {
    if (block.type === 'text' || block.type === 'private_key') {
      return Xss.html_escape(block.content).replace(/\n/g, '<br>') + '<br><br>';
    } else if (block.type === 'message') {
      return factory.embedded_message(block.complete ? Pgp.armor.normalize(block.content, 'message') : '', message_id, is_outgoing, sender_email, false);
    } else if (block.type === 'signed_message') {
      return factory.embedded_message(block.content, message_id, is_outgoing, sender_email, false);
    } else if (block.type === 'public_key') {
      return factory.embedded_pubkey(Pgp.armor.normalize(block.content, 'public_key'), is_outgoing);
    } else if (block.type === 'password_message') {
      return factory.embedded_message('', message_id, is_outgoing, sender_email, true, null, block.content); // here block.content is message short id
    } else if (block.type === 'attest_packet') {
      return factory.embedded_attest(block.content);
    } else if (block.type === 'cryptup_verification') {
      return factory.embedded_verification(block.content);
    } else {
      Catch.report('dunno how to process block type: ' + block.type);
      return '';
    }
  }

  public static time = {
    wait: (until_this_function_evaluates_true: () => boolean|undefined) => new Promise((success, error) => {
      let interval = Catch.set_interval(() => {
        let result = until_this_function_evaluates_true();
        if (result === true) {
          clearInterval(interval);
          if (success) {
            success();
          }
        } else if (result === false) {
          clearInterval(interval);
          if (error) {
            error();
          }
        }
      }, 50);
    }),
    sleep: (ms: number, set_timeout: (code: () => void, t: number) => void = Catch.set_timeout) => new Promise(resolve => set_timeout(resolve, ms)),
  };

  public static e = (name: string, attrs: t.Dict<string>) => $(`<${name}/>`, attrs)[0].outerHTML; // xss-tested: jquery escapes attributes

}

export class BrowserMsg {

  public static MAX_SIZE = 1024 * 1024; // 1MB
  private static HANDLERS_REGISTERED_BACKGROUND: t.Dict<t.BrowserMessageHandler>|null = null;
  private static HANDLERS_REGISTERED_FRAME: t.Dict<t.BrowserMessageHandler> = {};
  private static HANDLERS_STANDARD = {
    set_css: (data: {css: t.Dict<string|number>, selector: string, traverse_up?: number}) => {
      let element = $(data.selector);
      let traverse_up_levels = data.traverse_up as number || 0;
      for (let i = 0; i < traverse_up_levels; i++) {
        element = element.parent();
      }
      element.css(data.css);
    },
  } as t.Dict<t.BrowserMessageHandler>;

  public static send = (destination_string: string|null, name: string, data: t.Dict<any>|null=null) => {
    BrowserMsg.send_await(destination_string, name, data).catch(Catch.rejection);
  }

  public static send_await = (destination_string: string|null, name: string, data: t.Dict<any>|null=null): Promise<t.BrowserMessageResponse> => new Promise(resolve => {
    let msg = { name, data, to: destination_string || null, uid: Str.random(10), stack: Catch.stack_trace() };
    let try_resolve_no_undefined = (r?: t.BrowserMessageResponse) => Catch.try(() => resolve(typeof r === 'undefined' ? {} : r))();
    let is_background_page = Env.is_background_page();
    if (typeof  destination_string === 'undefined') { // don't know where to send the message
      Catch.log('BrowserMsg.send to:undefined');
      try_resolve_no_undefined();
    } else if (is_background_page && BrowserMsg.HANDLERS_REGISTERED_BACKGROUND && msg.to === null) {
      BrowserMsg.HANDLERS_REGISTERED_BACKGROUND[msg.name](msg.data, 'background', try_resolve_no_undefined); // calling from background script to background script: skip messaging completely
    } else if (is_background_page) {
      chrome.tabs.sendMessage(BrowserMsg.browser_message_destination_parse(msg.to).tab!, msg, {}, try_resolve_no_undefined);
    } else {
      chrome.runtime.sendMessage(msg, try_resolve_no_undefined);
    }
  })

  public static tab_id = async (): Promise<string|null|undefined> => {
    let r = await BrowserMsg.send_await(null, '_tab_', null);
    if(typeof r === 'string' || typeof r === 'undefined' || r === null) {
      return r; // for compatibility reasons when upgrading from 5.7.2 - can be removed later
    } else {
      return r.tab_id; // new format
    }
  }

  public static required_tab_id = async (): Promise<string> => {
    let tab_id;
    for(let i = 0; i < 10; i++) { // up to 10 attempts. Sometimes returns undefined right after browser start
      tab_id = await BrowserMsg.tab_id();
      if(tab_id) {
        return tab_id;
      }
      await Ui.time.sleep(200); // sleep 200ms between attempts
    }
    throw new TabIdRequiredError(`Tab id is required, but received '${String(tab_id)}' after 10 attempts`);
  }

  public static listen = (handlers: t.Dict<t.BrowserMessageHandler>, listen_for_tab_id='all') => {
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
    let processed:string[] = [];
    chrome.runtime.onMessage.addListener((msg, sender, respond) => {
      try {
        if (msg.to === listen_for_tab_id || msg.to === 'broadcast') {
          if (!Value.is(msg.uid).in(processed)) {
            processed.push(msg.uid);
            if (typeof BrowserMsg.HANDLERS_REGISTERED_FRAME[msg.name] !== 'undefined') {
              let r = BrowserMsg.HANDLERS_REGISTERED_FRAME[msg.name](msg.data, sender, respond);
              if(r && typeof r === 'object' && (r as Promise<void>).then && (r as Promise<void>).catch) {
                // todo - a way to callback the error to be re-thrown to caller stack
                (r as Promise<void>).catch(Catch.rejection);
              }
            } else if (msg.name !== '_tab_' && msg.to !== 'broadcast') {
              if (BrowserMsg.browser_message_destination_parse(msg.to).frame !== null) { // only consider it an error if frameId was set because of firefox bug: https://bugzilla.mozilla.org/show_bug.cgi?id=1354337
                Catch.report('BrowserMsg.listen error: handler "' + msg.name + '" not set', 'Message sender stack:\n' + msg.stack);
              } else { // once firefox fixes the bug, it will behave the same as Chrome and the following will never happen.
                console.log('BrowserMsg.listen ignoring missing handler "' + msg.name + '" due to Firefox Bug');
              }
            }
          }
        }
        return !!respond; // indicate that this listener intends to respond
      } catch(e) {
        // todo - a way to callback the error to be re-thrown to caller stack
        Catch.handle_exception(e);
      }
    });
  }

  public static listen_background = (handlers: t.Dict<t.BrowserMessageHandler>) => {
    if (!BrowserMsg.HANDLERS_REGISTERED_BACKGROUND) {
      BrowserMsg.HANDLERS_REGISTERED_BACKGROUND = handlers;
    } else {
      for (let name of Object.keys(handlers)) {
        BrowserMsg.HANDLERS_REGISTERED_BACKGROUND[name] = handlers[name];
      }
    }
    chrome.runtime.onMessage.addListener((msg, sender, respond) => {
      try {
        let safe_respond = (response: any) => {
          try { // avoiding unnecessary errors when target tab gets closed
            respond(response);
          } catch (e) {
            // todo - the sender should still know - could have PageClosedError
            if (e.message !== 'Attempting to use a disconnected port object') {
              Catch.handle_exception(e);
              throw e;
            }
          }
        };
        if (msg.to && msg.to !== 'broadcast') {
          msg.sender = sender;
          chrome.tabs.sendMessage(BrowserMsg.browser_message_destination_parse(msg.to).tab!, msg, {}, safe_respond);
        } else if (Value.is(msg.name).in(Object.keys(BrowserMsg.HANDLERS_REGISTERED_BACKGROUND!))) { // is !null because added above
          let r = BrowserMsg.HANDLERS_REGISTERED_BACKGROUND![msg.name](msg.data, sender, safe_respond); // is !null because checked above
          if(r && typeof r === 'object' && (r as Promise<void>).then && (r as Promise<void>).catch) {
            // todo - a way to callback the error to be re-thrown to caller stack
            (r as Promise<void>).catch(Catch.rejection);
          }
        } else if (msg.to !== 'broadcast') {
          Catch.report('BrowserMsg.listen_background error: handler "' + msg.name + '" not set', 'Message sender stack:\n' + msg.stack);
        }
        return !!respond; // indicate that we intend to respond later
      } catch (e) {
        // todo - a way to callback the error to be re-thrown to caller stack
        Catch.handle_exception(e);
      }
    });
  }

  private static browser_message_destination_parse = (destination_string: string|null) => {
    let parsed = { tab: null as null|number, frame: null as null|number };
    if (destination_string) {
      parsed.tab = Number(destination_string.split(':')[0]);
      // @ts-ignore - adding nonsense into isNaN
      parsed.frame = !isNaN(destination_string.split(':')[1]) ? Number(destination_string.split(':')[1]) : null;
    }
    return parsed;
  }

}

export class Xss {

  private static ALLOWED_HTML_TAGS = ['p', 'div', 'br', 'u', 'i', 'em', 'b', 'ol', 'ul', 'pre', 'li', 'table', 'tr', 'td', 'th', 'img', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'address', 'blockquote', 'dl', 'fieldset', 'a', 'font'];
  private static ADD_ATTR = ['email', 'page', 'addurltext', 'longid', 'index'];
  private static HREF_REGEX_CACHE = null as null|RegExp;

  public static sanitize_render = (selector: string|HTMLElement|JQuery<HTMLElement>, dirty_html: string) => $(selector as any).html(Xss.html_sanitize(dirty_html)); // xss-sanitized

  public static sanitize_append = (selector: string|HTMLElement|JQuery<HTMLElement>, dirty_html: string) => $(selector as any).append(Xss.html_sanitize(dirty_html)); // xss-sanitized

  public static sanitize_prepend = (selector: string|HTMLElement|JQuery<HTMLElement>, dirty_html: string) => $(selector as any).prepend(Xss.html_sanitize(dirty_html)); // xss-sanitized

  public static sanitize_replace = (selector: string|HTMLElement|JQuery<HTMLElement>, dirty_html: string) => $(selector as any).replaceWith(Xss.html_sanitize(dirty_html)); // xss-sanitized

  public static html_sanitize = (dirty_html: string): string => { // originaly text_or_html
    return DOMPurify.sanitize(dirty_html, {
      SAFE_FOR_JQUERY: true,
      ADD_ATTR: Xss.ADD_ATTR,
      ALLOWED_URI_REGEXP: Xss.sanitize_href_regexp(),
    });
  }

  public static html_sanitize_keep_basic_tags = (dirty_html: string): string => {
    // used whenever untrusted remote content (eg html email) is rendered, but we still want to preserve html
    DOMPurify.removeAllHooks();
    DOMPurify.addHook('afterSanitizeAttributes', node => {
      if ('src' in node) {
        // replace images with a link that points to that image
        let img: Element = node;
        let src = img.getAttribute('src')!;
        let title = img.getAttribute('title');
        img.removeAttribute('src');
        let a = document.createElement('a');
        a.href = src;
        a.className = 'image_src_link';
        a.target = '_blank';
        a.innerText = title || 'show image';
        let heightWidth = `height: ${img.clientHeight ? `${Number(img.clientHeight)}px` : 'auto'}; width: ${img.clientWidth ? `${Number(img.clientWidth)}px` : 'auto'};`;
        a.setAttribute('style', `text-decoration: none; background: #FAFAFA; padding: 4px; border: 1px dotted #CACACA; display: inline-block; ${heightWidth}`);
        img.outerHTML = a.outerHTML; // xss-safe-value - "a" was build using dom node api
      }
      if ('target' in node) { // open links in new window
        (node as Element).setAttribute('target', '_blank');
      }
    });
    let clean_html = DOMPurify.sanitize(dirty_html, {
      SAFE_FOR_JQUERY: true,
      ADD_ATTR: Xss.ADD_ATTR,
      ALLOWED_TAGS: Xss.ALLOWED_HTML_TAGS,
      ALLOWED_URI_REGEXP: Xss.sanitize_href_regexp(),
    });
    DOMPurify.removeAllHooks();
    return clean_html;
  }

  public static html_sanitize_and_strip_all_tags = (dirty_html: string, output_newline: string): string => {
    let html = Xss.html_sanitize_keep_basic_tags(dirty_html);
    let random = Str.random(5);
    let br = `CU_BR_${random}`;
    let block_start = `CU_BS_${random}`;
    let block_end = `CU_BE_${random}`;
    html = html.replace(/<br[^>]*>/gi, br);
    html = html.replace(/\n/g, '');
    html = html.replace(/<\/(p|h1|h2|h3|h4|h5|h6|ol|ul|pre|address|blockquote|dl|div|fieldset|form|hr|table)[^>]*>/gi, block_end);
    html = html.replace(/<(p|h1|h2|h3|h4|h5|h6|ol|ul|pre|address|blockquote|dl|div|fieldset|form|hr|table)[^>]*>/gi, block_start);
    html = html.replace(RegExp(`(${block_start})+`, 'g'), block_start).replace(RegExp(`(${block_end})+`, 'g'), block_end);
    html = html.split(block_end + block_start).join(br).split(br + block_end).join(br);
    let text = html.split(br).join('\n').split(block_start).filter(v => !!v).join('\n').split(block_end).filter(v => !!v).join('\n');
    text = text.replace(/\n{2,}/g, '\n\n');
    // not all tags were removed above. Remove all remaining tags
    text = DOMPurify.sanitize(text, {SAFE_FOR_JQUERY: true, ALLOWED_TAGS: []});
    text = text.trim();
    if(output_newline !== '\n') {
      text = text.replace(/\n/g, output_newline);
    }
    return text;
  }

  public static html_escape = (str: string) => str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\//g, '&#x2F;');

  public static html_unescape = (str: string) => {
    // the &nbsp; at the end is replaced with an actual NBSP character, not a space character. IDE won't show you the difference. Do not change.
    return str.replace(/&#x2F;/g, '/').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ');
  }

  private static sanitize_href_regexp = () => { // allow href links that have same origin as our extension + cid
    if(Xss.HREF_REGEX_CACHE === null) {
      if (window && window.location && window.location.origin && window.location.origin.match(/^(?:chrome-extension|moz-extension):\/\/[a-z0-9\-]+$/g)) {
        Xss.HREF_REGEX_CACHE = new RegExp(`^(?:(http|https|cid):|${Str.regex_escape(window.location.origin)}|[^a-z]|[a-z+.\\-]+(?:[^a-z+.\\-:]|$))`, 'i');
      } else {
        Xss.HREF_REGEX_CACHE = /^(?:(http|https):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;
      }
    }
    return Xss.HREF_REGEX_CACHE;
  }

}

export class Str {

  public static parse_email = (email_string: string) => {
    if (Value.is('<').in(email_string) && Value.is('>').in(email_string)) {
      return {
        email: email_string.substr(email_string.indexOf('<') + 1, email_string.indexOf('>') - email_string.indexOf('<') - 1).replace(/["']/g, '').trim().toLowerCase(),
        name: email_string.substr(0, email_string.indexOf('<')).replace(/["']/g, '').trim(),
        full: email_string,
      };
    }
    return {
      email: email_string.replace(/["']/g, '').trim().toLowerCase(),
      name: null,
      full: email_string,
    };
  }

  public static pretty_print = (obj: any) => (typeof obj === 'object') ? JSON.stringify(obj, null, 2).replace(/ /g, '&nbsp;').replace(/\n/g, '<br>') : String(obj);

  public static normalize_spaces = (str: string) => str.replace(RegExp(String.fromCharCode(160), 'g'), String.fromCharCode(32)).replace(/\n /g, '\n');

  public static normalize_dashes = (str: string) => str.replace(/^—–|—–$/gm, '-----');

  public static normalize = (str: string) => Str.normalize_spaces(Str.normalize_dashes(str));

  public static number_format = (number: number) => { // http://stackoverflow.com/questions/3753483/javascript-thousand-separator-string-format
    let nStr: string = number + '';
    let x = nStr.split('.');
    let x1 = x[0];
    let x2 = x.length > 1 ? '.' + x[1] : '';
    let rgx = /(\d+)(\d{3})/;
    while(rgx.test(x1)) {
      x1 = x1.replace(rgx, '$1' + ',' + '$2');
    }
    return x1 + x2;
  }

  public static is_email_valid = (email: string) => /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/i.test(email);

  public static month_name = (month_index: number) => ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][month_index];

  public static random = (length:number=5) => {
    let id = '';
    let possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    for (let i = 0; i < length; i++) {
      id += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return id;
  }

  public static regex_escape = (to_be_used_in_regex: string) => to_be_used_in_regex.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  public static html_attribute_encode = (values: t.Dict<any>): string => Str.base64url_utf_encode(JSON.stringify(values));

  public static html_attribute_decode = (encoded: string): t.FlowCryptAttachmentLinkData|any => JSON.parse(Str.base64url_utf_decode(encoded));

  public static base64url_encode = (str: string) => (typeof str === 'undefined') ? str : btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); // used for 3rd party API calls - do not change w/o testing Gmail api attachments

  public static base64url_decode = (str: string) => (typeof str === 'undefined') ? str : atob(str.replace(/-/g, '+').replace(/_/g, '/')); // used for 3rd party API calls - do not change w/o testing Gmail api attachments

  public static from_uint8 = (u8a: Uint8Array|string): string => {
    if(typeof u8a === 'string') {
      return u8a;
    }
    let CHUNK_SZ = 0x8000;
    let c = [];
    for (let i = 0; i < u8a.length; i += CHUNK_SZ) {
      c.push(String.fromCharCode.apply(null, u8a.subarray(i, i + CHUNK_SZ)));
    }
    return c.join('');
  }

  public static to_uint8 = (raw: string|Uint8Array): Uint8Array => {
    if(raw instanceof Uint8Array) {
      return raw;
    }
    let rawLength = raw.length;
    let uint8 = new Uint8Array(new ArrayBuffer(rawLength));
    for (let i = 0; i < rawLength; i++) {
      uint8[i] = raw.charCodeAt(i);
    }
    return uint8;
  }

  public static from_equal_sign_notation_as_utf = (str: string): string => {
    return str.replace(/(=[A-F0-9]{2})+/g, equal_sign_utf_part => {
      return Str.uint8_as_utf(equal_sign_utf_part.replace(/^=/, '').split('=').map((two_hex_digits) => parseInt(two_hex_digits, 16)));
    });
  }

  public static uint8_as_utf = (a: Uint8Array|number[]) => { // tom
    let length = a.length;
    let bytes_left_in_char = 0;
    let utf8_string = '';
    let binary_char = '';
    for (let i = 0; i < length; i++) {
      if (a[i] < 128) {
        if (bytes_left_in_char) { // utf-8 continuation byte missing, assuming the last character was an 8-bit ASCII character
          utf8_string += String.fromCharCode(a[i-1]);
        }
        bytes_left_in_char = 0;
        binary_char = '';
        utf8_string += String.fromCharCode(a[i]);
      } else {
        if (!bytes_left_in_char) { // beginning of new multi-byte character
          if (a[i] >= 128 && a[i] < 192) { // 10xx xxxx
            utf8_string += String.fromCharCode(a[i]); // extended 8-bit ASCII compatibility, european ASCII characters
          } else if (a[i] >= 192 && a[i] < 224) { // 110x xxxx
            bytes_left_in_char = 1;
            binary_char = a[i].toString(2).substr(3);
          } else if (a[i] >= 224 && a[i] < 240) { // 1110 xxxx
            bytes_left_in_char = 2;
            binary_char = a[i].toString(2).substr(4);
          } else if (a[i] >= 240 && a[i] < 248) { // 1111 0xxx
            bytes_left_in_char = 3;
            binary_char = a[i].toString(2).substr(5);
          } else if (a[i] >= 248 && a[i] < 252) { // 1111 10xx
            bytes_left_in_char = 4;
            binary_char = a[i].toString(2).substr(6);
          } else if (a[i] >= 252 && a[i] < 254) { // 1111 110x
            bytes_left_in_char = 5;
            binary_char = a[i].toString(2).substr(7);
          } else {
            console.log('Str.uint8_as_utf: invalid utf-8 character beginning byte: ' + a[i]);
          }
        } else { // continuation of a multi-byte character
          binary_char += a[i].toString(2).substr(2);
          bytes_left_in_char--;
        }
        if (binary_char && !bytes_left_in_char) {
          utf8_string += String.fromCharCode(parseInt(binary_char, 2));
          binary_char = '';
        }
      }
    }
    return utf8_string;
  }

  public static to_hex = (s: string): string => { // http://phpjs.org/functions/bin2hex/, Kevin van Zonneveld (http://kevin.vanzonneveld.net), Onno Marsman, Linuxworld, ntoniazzi
    let o = '';
    s += '';
    for (let i = 0; i < s.length; i++) {
      let n = s.charCodeAt(i).toString(16);
      o += n.length < 2 ? '0' + n : n;
    }
    return o;
  }

  public static from_hex = (hex: string): string => {
    let str = '';
    for (let i = 0; i < hex.length; i += 2) {
      let v = parseInt(hex.substr(i, 2), 16);
      if (v) {
        str += String.fromCharCode(v);
      }
    }
    return str;
  }

  public static extract_fc_attachments = (decrypted_content: string, fc_attachments: Attachment[]) => {
    if (Value.is('cryptup_file').in(decrypted_content)) {
      decrypted_content = decrypted_content.replace(/<a[^>]+class="cryptup_file"[^>]+>[^<]+<\/a>\n?/gm, found_link => {
        let element = $(found_link);
        let fc_data = element.attr('cryptup-data');
        if (fc_data) {
          let a: t.FlowCryptAttachmentLinkData = Str.html_attribute_decode(fc_data);
          if(a && typeof a === 'object' && typeof a.name !== 'undefined' && typeof a.size !== 'undefined' && typeof a.type !== 'undefined') {
            fc_attachments.push(new Attachment({type: a.type, name: a.name, length: a.size, url: element.attr('href')}));
          }
        }
        return '';
      });
    }
    return decrypted_content;
  }

  public static extract_fc_reply_token = (decrypted_content: string) => { // todo - used exclusively on the web - move to a web package
    let fc_token_element = $(Ui.e('div', {html: decrypted_content})).find('.cryptup_reply');
    if (fc_token_element.length) {
      let fc_data = fc_token_element.attr('cryptup-data');
      if (fc_data) {
        return Str.html_attribute_decode(fc_data);
      }
    }
  }

  public static strip_fc_reply_token = (decrypted_content: string) => decrypted_content.replace(/<div[^>]+class="cryptup_reply"[^>]+><\/div>/, '');

  public static strip_public_keys = (decrypted_content: string, found_public_keys: string[]) => {
    let {blocks, normalized} = Pgp.armor.detect_blocks(decrypted_content);
    for (let block of blocks) {
      if (block.type === 'public_key') {
        found_public_keys.push(block.content);
        normalized = normalized.replace(block.content, '');
      }
    }
    return normalized;
  }

  public static int_to_hex = (int_as_string: string|number): string => { // http://stackoverflow.com/questions/18626844/convert-a-large-integer-to-a-hex-string-in-javascript (Collin Anderson)
    let dec = int_as_string.toString().split(''), sum = [], hex = [], i, s;
    while(dec.length) {
      s = Number(dec.shift());
      for(i = 0; s || i < sum.length; i++) {
        s += (sum[i] || 0) * 10;
        sum[i] = s % 16;
        s = (s - sum[i]) / 16;
      }
    }
    while(sum.length) {
      hex.push(sum.pop()!.toString(16));
    }
    return hex.join('');
  }

  public static capitalize = (string: string): string => string.trim().split(' ').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');

  public static to_utc_timestamp = (datetime_string: string, as_string:boolean=false) => as_string ? String(Date.parse(datetime_string)) : Date.parse(datetime_string);

  public static datetime_to_date = (date: string) => Xss.html_escape(date.substr(0, 10));

  private static base64url_utf_encode = (str: string) => { // https://stackoverflow.com/questions/30106476/using-javascripts-atob-to-decode-base64-doesnt-properly-decode-utf-8-strings
    return (typeof str === 'undefined') ? str : btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (match, p1) => String.fromCharCode(parseInt(p1, 16)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  private static base64url_utf_decode = (str: string) => { // https://stackoverflow.com/questions/30106476/using-javascripts-atob-to-decode-base64-doesnt-properly-decode-utf-8-strings
    return (typeof str === 'undefined') ? str : decodeURIComponent(Array.prototype.map.call(atob(str.replace(/-/g, '+').replace(/_/g, '/')), (c: string) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
  }

}

export class Mime {

  public static process = async (mime_message: string) => {
    let decoded = await Mime.decode(mime_message);
    if (typeof decoded.text === 'undefined' && typeof decoded.html !== 'undefined' && typeof $_HOST_html_to_text === 'function') { // android
      decoded.text = $_HOST_html_to_text(decoded.html); // temporary solution
    }
    let blocks: t.MessageBlock[] = [];
    if (decoded.text) {  // may be undefined or empty
      blocks = blocks.concat(Pgp.armor.detect_blocks(decoded.text).blocks);
    }
    for (let file of decoded.attachments) {
      let treat_as = file.treat_as();
      if (treat_as === 'message') {
        let armored = Pgp.armor.clip(file.as_text());
        if (armored) {
          blocks.push(Pgp.internal.crypto_armor_block_object('message', armored));
        }
      } else if (treat_as === 'signature') {
        decoded.signature = decoded.signature || file.as_text();
      } else if (treat_as === 'public_key') {
        blocks = blocks.concat(Pgp.armor.detect_blocks(file.as_text()).blocks);
      }
    }
    if (decoded.signature) {
      for (let block of blocks) {
        if (block.type === 'text') {
          block.type = 'signed_message';
          block.signature = decoded.signature;
        }
      }
    }
    return {headers: decoded.headers, blocks};
  }

  public static headers_to_from = (parsed_mime_message: t.MimeContent): t.FromToHeaders => {
    let header_to: string[] = [];
    let header_from;
    // @ts-ignore - I should check this - does it really have .address?
    if (parsed_mime_message.headers.from && parsed_mime_message.headers.from.length && parsed_mime_message.headers.from[0] && parsed_mime_message.headers.from[0].address) {
      // @ts-ignore - I should check this - does it really have .address?
      header_from = parsed_mime_message.headers.from[0].address;
    }
    if (parsed_mime_message.headers.to && parsed_mime_message.headers.to.length) {
      for (let to of parsed_mime_message.headers.to) {
        // @ts-ignore - I should check this - does it really have .address?
        if (to.address) {
          // @ts-ignore - I should check this - does it really have .address?
          header_to.push(to.address);
        }
      }
    }
    return { from: header_from, to: header_to };
  }

  public static reply_headers = (parsed_mime_message: t.MimeContent) => {
    let message_id = parsed_mime_message.headers['message-id'] || '';
    let references = parsed_mime_message.headers['in-reply-to'] || '';
    return { 'in-reply-to': message_id, 'references': references + ' ' + message_id };
  }

  public static resembles_message = (message: string|Uint8Array) => {
    let m = message.slice(0, 1000);
    // noinspection SuspiciousInstanceOfGuard
    if (m instanceof Uint8Array) {
      m = Str.from_uint8(m);
    }
    m = m.toLowerCase();
    let contentType = m.match(/content-type: +[0-9a-z\-\/]+/);
    if (contentType === null) {
      return false;
    }
    if (m.match(/content-transfer-encoding: +[0-9a-z\-\/]+/) || m.match(/content-disposition: +[0-9a-z\-\/]+/) || m.match(/; boundary=/) || m.match(/; charset=/)) {
      return true;
    }
    return Boolean(contentType.index === 0 && m.match(/boundary=/));
  }

  public static decode = (mime_message: string): Promise<t.MimeContent> => {
    return new Promise(async resolve => {
      let mime_content = {attachments: [], headers: {} as t.FlatHeaders, text: undefined, html: undefined, signature: undefined} as t.MimeContent;
      try {
        let MimeParser = (window as t.BrowserWidnow)['emailjs-mime-parser'];
        let parser = new MimeParser();
        let parsed: {[key: string]: t.MimeParserNode} = {};
        parser.onheader = (node: t.MimeParserNode) => {
          if (!String(node.path.join('.'))) { // root node headers
            for (let name of Object.keys(node.headers)) {
              mime_content.headers[name] = node.headers[name][0].value;
            }
          }
        };
        parser.onbody = (node: t.MimeParserNode) => {
          let path = String(node.path.join('.'));
          if (typeof parsed[path] === 'undefined') {
            parsed[path] = node;
          }
        };
        parser.onend = () => {
          for (let node of Object.values(parsed)) {
            if (Mime.get_node_type(node) === 'application/pgp-signature') {
              mime_content.signature = node.rawContent;
            } else if (Mime.get_node_type(node) === 'text/html' && !Mime.get_node_filename(node)) {
              // html content may be broken up into smaller pieces by attachments in between
              // AppleMail does this with inline attachments
              mime_content.html = (mime_content.html || '') + Mime.get_node_content_as_text(node);
            } else if (Mime.get_node_type(node) === 'text/plain' && !Mime.get_node_filename(node)) {
              mime_content.text = Mime.get_node_content_as_text(node);
            } else {
              mime_content.attachments.push(new Attachment({
                name: Mime.get_node_filename(node),
                type: Mime.get_node_type(node),
                data: node.content,
                cid: Mime.get_node_content_id(node),
              }));
            }
          }
          resolve(mime_content);
        };
        parser.write(mime_message);
        parser.end();
      } catch (e) {
        Catch.handle_exception(e);
        resolve(mime_content);
      }
    });
  }

  public static encode = async (body:string|t.SendableMessageBody, headers: t.RichHeaders, attachments:Attachment[]=[]): Promise<string> => {
    let MimeBuilder = (window as t.BrowserWidnow)['emailjs-mime-builder'];
    let root_node = new MimeBuilder('multipart/mixed');
    for (let key of Object.keys(headers)) {
      root_node.addHeader(key, headers[key]);
    }
    if (typeof body === 'string') {
      body = {'text/plain': body};
    }
    let content_node: t.MimeParserNode;
    if (Object.keys(body).length === 1) {
      content_node = Mime.new_content_node(MimeBuilder, Object.keys(body)[0], body[Object.keys(body)[0] as "text/plain"|"text/html"] || '');
    } else {
      content_node = new MimeBuilder('multipart/alternative');
      for (let type of Object.keys(body)) {
        content_node.appendChild(Mime.new_content_node(MimeBuilder, type, body[type]!)); // already present, that's why part of for loop
      }
    }
    root_node.appendChild(content_node);
    for (let attachment of attachments) {
      let type = `${attachment.type}; name="${attachment.name}"`;
      let header = {'Content-Disposition': 'attachment', 'X-Attachment-Id': `f_${Str.random(10)}`, 'Content-Transfer-Encoding': 'base64'};
      root_node.appendChild(new MimeBuilder(type, { filename: attachment.name }).setHeader(header).setContent(attachment.data()));
    }
    return root_node.build();
  }

  public static signed = (mime_message: string) => {
    /*
      Trying to grab the full signed content that may look like this in its entirety (it's a signed mime message. May also be signed plain text)
      Unfortunately, emailjs-mime-parser was not able to do this, or I wasn't able to use it properly

      --eSmP07Gus5SkSc9vNmF4C0AutMibfplSQ
      Content-Type: multipart/mixed; boundary="XKKJ27hlkua53SDqH7d1IqvElFHJROQA1"
      From: Henry Electrum <henry.electrum@gmail.com>
      To: human@flowcrypt.com
      Message-ID: <abd68ba1-35c3-ee8a-0d60-0319c608d56b@gmail.com>
      Subject: compatibility - simples signed email

      --XKKJ27hlkua53SDqH7d1IqvElFHJROQA1
      Content-Type: text/plain; charset=utf-8
      Content-Transfer-Encoding: quoted-printable

      content

      --XKKJ27hlkua53SDqH7d1IqvElFHJROQA1--
      */
    let signed_header_index = mime_message.substr(0, 100000).toLowerCase().indexOf('content-type: multipart/signed');
    if (signed_header_index !== -1) {
      mime_message = mime_message.substr(signed_header_index);
      let first_boundary_index = mime_message.substr(0, 1000).toLowerCase().indexOf('boundary=');
      if (first_boundary_index) {
        let boundary = mime_message.substr(first_boundary_index, 100);
        boundary = (boundary.match(/boundary="[^"]{1,70}"/gi) || boundary.match(/boundary=[a-z0-9][a-z0-9 ]{0,68}[a-z0-9]/gi) || [])[0];
        if (boundary) {
          boundary = boundary.replace(/^boundary="?|"$/gi, '');
          let boundary_begin = '\r\n--' + boundary + '\r\n';
          let boundary_end = '--' + boundary + '--';
          let end_index = mime_message.indexOf(boundary_end);
          if (end_index !== -1) {
            mime_message = mime_message.substr(0, end_index + boundary_end.length);
            if (mime_message) {
              let result = { full: mime_message, signed: null as string|null, signature: null as string|null };
              let first_part_start_index = mime_message.indexOf(boundary_begin);
              if (first_part_start_index !== -1) {
                first_part_start_index += boundary_begin.length;
                let first_part_end_index = mime_message.indexOf(boundary_begin, first_part_start_index);
                let second_part_start_index = first_part_end_index + boundary_begin.length;
                let second_part_end_index = mime_message.indexOf(boundary_end, second_part_start_index);
                if (second_part_end_index !== -1) {
                  let first_part = mime_message.substr(first_part_start_index, first_part_end_index - first_part_start_index);
                  let second_part = mime_message.substr(second_part_start_index, second_part_end_index - second_part_start_index);
                  if (first_part.match(/^content-type: application\/pgp-signature/gi) !== null && Value.is('-----BEGIN PGP SIGNATURE-----').in(first_part) && Value.is('-----END PGP SIGNATURE-----').in(first_part)) {
                    result.signature = Pgp.armor.clip(first_part);
                    result.signed = second_part;
                  } else {
                    result.signature = Pgp.armor.clip(second_part);
                    result.signed = first_part;
                  }
                  return result;
                }
              }
            }
          }
        }
      }
    }
  }

  private static get_node_type = (node: t.MimeParserNode) => {
    if (node.headers['content-type'] && node.headers['content-type'][0]) {
      return node.headers['content-type'][0].value;
    }
  }

  private static get_node_content_id = (node: t.MimeParserNode) => {
    if (node.headers['content-id'] && node.headers['content-id'][0]) {
      return node.headers['content-id'][0].value;
    }
  }

  private static get_node_filename = (node: t.MimeParserNode) => {
    // @ts-ignore - lazy
    if (node.headers['content-disposition'] && node.headers['content-disposition'][0] && node.headers['content-disposition'][0].params && node.headers['content-disposition'][0].params.filename) {
      // @ts-ignore - lazy
      return node.headers['content-disposition'][0].params.filename;
    }
    // @ts-ignore - lazy
    if (node.headers['content-type'] && node.headers['content-type'][0] && node.headers['content-type'][0].params && node.headers['content-type'][0].params.name) {
      // @ts-ignore - lazy
      return node.headers['content-type'][0].params.name;
    }
  }

  private static get_node_content_as_text = (node: t.MimeParserNode): string => {
    if(node.charset === 'utf-8' && node.contentTransferEncoding.value === 'base64') {
      return Str.uint8_as_utf(node.content);
    }
    if(node.charset === 'utf-8' && node.contentTransferEncoding.value === 'quoted-printable') {
      return Str.from_equal_sign_notation_as_utf(node.rawContent);
    }
    if(node.charset === 'iso-8859-2') {
      return (window as t.FcWindow).iso88592.decode(node.rawContent);  // todo - use iso88592.labels for detection
    }
    return node.rawContent;
  }

  private static new_content_node = (MimeBuilder: t.AnyThirdPartyLibrary, type: string, content: string): t.MimeParserNode => {
    let node = new MimeBuilder(type).setContent(content);
    if (type === 'text/plain') {
      node.addHeader('Content-Transfer-Encoding', 'quoted-printable'); // gmail likes this
    }
    return node;
  }

}

export class Catch {

  private static RUNTIME: t.Dict<string> = {};
  private static ORIGINAL_ON_ERROR = window.onerror;

  public static handle_error = (error_message: string|undefined, url: string, line: number, col: number, error: string|Error|t.Dict<Serializable>, is_manually_called: boolean, version: string, env: string) => {
    if (typeof error === 'string') {
      error_message = error;
      error = { name: 'thrown_string', message: error_message, stack: error_message };
    }
    if (error_message && url && typeof line !== 'undefined' && !col && !error && !is_manually_called && !version && !env) { // safari has limited support
      error = { name: 'safari_error', message: error_message, stack: error_message };
    }
    if (typeof error_message === 'undefined' && line === 0 && col === 0 && is_manually_called && typeof error === 'object' && !(error instanceof Error)) {
      let stringified;
      try { // this sometimes happen with unhandled Promise.then(_, reject)
        stringified = JSON.stringify(error);
      } catch (cannot) {
        stringified = 'typeof: ' + (typeof error) + '\n' + String(error);
      }
      error = { name: 'thrown_object', message: error.message || '(unknown)', stack: stringified};
      error_message = 'thrown_object';
    }
    let user_log_message = ' Please report errors above to human@flowcrypt.com. I fix errors VERY promptly.';
    let ignored_errors = [
      'Invocation of form get(, function) doesn\'t match definition get(optional string or array or object keys, function callback)', // happens in gmail window when reloaded extension + now reloading gmail
      'Invocation of form set(, function) doesn\'t match definition set(object items, optional function callback)', // happens in gmail window when reloaded extension + now reloading gmail
      'Invocation of form runtime.connect(null, ) doesn\'t match definition runtime.connect(optional string extensionId, optional object connectInfo)',
    ];
    if (!error) {
      return;
    }
    if (error instanceof Error && ignored_errors.indexOf(error.message) !== -1) {
      return true;
    }
    if (error instanceof Error && error.stack) {
      console.log('%c[' + error_message + ']\n' + error.stack, 'color: #F00; font-weight: bold;');
    } else {
      console.error(error);
      console.log('%c' + error_message, 'color: #F00; font-weight: bold;');
    }
    if (is_manually_called !== true && Catch.ORIGINAL_ON_ERROR && Catch.ORIGINAL_ON_ERROR !== (Catch.handle_error as ErrorEventHandler)) {
      Catch.ORIGINAL_ON_ERROR.apply(null, arguments); // Call any previously assigned handler
    }
    if (error instanceof Error && (error.stack || '').indexOf('PRIVATE') !== -1) {
      return;
    }
    if (error instanceof UnreportableError) {
      return;
    }
    try {
      $.ajax({
        url: 'https://flowcrypt.com/api/help/error',
        method: 'POST',
        data: JSON.stringify({
          name: ((error as Error).name || '').substring(0, 50), // todo - remove cast & debug
          message: (error_message || '').substring(0, 200),
          url: (url || '').substring(0, 100),
          line: line || 0,
          col: col || 0,
          trace: (error as Error).stack || '', // todo - remove cast & debug
          version: version || Catch.version() || 'unknown',
          environment: env || Catch.environment(),
        }),
        dataType: 'json',
        crossDomain: true,
        contentType: 'application/json; charset=UTF-8',
        async: true,
        success: (response) => {
          if (response.saved === true) {
            console.log('%cFlowCrypt ERROR:' + user_log_message, 'font-weight: bold;');
          } else {
            console.log('%cFlowCrypt EXCEPTION:' + user_log_message, 'font-weight: bold;');
          }
        },
        error: (XMLHttpRequest, status, error) => {
          console.log('%cFlowCrypt FAILED:' + user_log_message, 'font-weight: bold;');
        },
      });
    } catch (ajax_err) {
      console.log(ajax_err.message);
      console.log('%cFlowCrypt ISSUE:' + user_log_message, 'font-weight: bold;');
    }
    try {
      if (typeof Store.get_account === 'function' && typeof Store.set === 'function') {
        Store.get_global(['errors']).then(s => {
          if (typeof s.errors === 'undefined') {
            s.errors = [];
          }
          if(error instanceof Error) {
            s.errors.unshift(error.stack || error_message || String(error));
          } else {
            s.errors.unshift(error_message || String(error));
          }
          Store.set(null, s).catch(console.error);
        }).catch(console.error);
      }
    } catch (storage_err) {
      console.log('failed to locally log error "' + String(error_message) + '" because: ' + storage_err.message);
    }
    return true;
  }

  public static handle_exception = (exception: any) => {
    let line, col;
    try {
      let caller_line = exception.stack!.split('\n')[1]; // will be catched below
      let matched = caller_line.match(/\.js:([0-9]+):([0-9]+)\)?/);
      line = Number(matched![1]); // will be catched below
      col = Number(matched![2]); // will be catched below
    } catch (line_err) {
      line = 0;
      col = 0;
    }
    Catch.RUNTIME = Catch.RUNTIME || {};
    Catch.handle_error(exception.message, window.location.href, line, col, exception, true, Catch.RUNTIME.version, Catch.RUNTIME.environment);
  }

  public static report = (name: string, details:Error|Serializable|t.StandardError|PromiseRejectionEvent=undefined) => {
    try {
      // noinspection ExceptionCaughtLocallyJS
      throw new Error(name);
    } catch (e) {
      if (typeof details !== 'string') {
        try {
          details = JSON.stringify(details);
        } catch (stringify_error) {
          details = '(could not stringify details "' + String(details) + '" in Catch.report because: ' + stringify_error.message + ')';
        }
      }
      e.stack = e.stack + '\n\n\ndetails: ' + details;
      Catch.handle_exception(e);
    }
  }

  public static log = (name: string, details:Serializable|Error|t.Dict<Serializable>=undefined) => {
    name = 'Catch.log: ' + name;
    console.log(name);
    try {
      // noinspection ExceptionCaughtLocallyJS
      throw new Error(name);
    } catch (e_local) {
      let e = e_local as Error;
      if (typeof details !== 'string') {
        try {
          details = JSON.stringify(details);
        } catch (stringify_error) {
          details = '(could not stringify details "' + String(details) + '" in Catch.log because: ' + stringify_error.message + ')';
        }
      }
      e.stack = e.stack + '\n\n\ndetails: ' + details;
      try {
        Store.get_global(['errors']).then(s => {
          if (typeof s.errors === 'undefined') {
            s.errors = [];
          }
          s.errors.unshift(e.stack || name);
          Store.set(null, s).catch(console.error);
        }).catch(console.error);
      } catch (storage_err) {
        console.log('failed to locally log info "' + String(name) + '" because: ' + storage_err.message);
      }
    }
  }

  public static version = (format='original') => {
    if (format === 'int') {
      return Catch.RUNTIME.version ? Number(Catch.RUNTIME.version.replace(/\./g, '')) : null;
    } else {
      return Catch.RUNTIME.version || null;
    }
  }

  public static try = (code: Function) => () => { // tslint:disable-line:ban-types // returns a function
    try {
      let r = code();
      if (r && typeof r === 'object' && typeof r.then === 'function' && typeof r.catch === 'function') { // a promise - async catching
        r.catch(Catch.rejection);
      }
    } catch (code_err) {
      Catch.handle_exception(code_err);
    }
  }

  public static environment = (url=window.location.href): string => {
    let browser_name = Env.browser().name;
    let env = 'unknown';
    if (url.indexOf('bnjglocicd') !== -1) {
      env = 'ex:prod';
    } else if (url.indexOf('gjdhkacdgd') !== -1) {
      env = 'ex:dev';
    } else if (url.indexOf('gjdhkacdgd') !== -1) { // in case it differs in the future
      env = 'ex:test';
    } else if (url.indexOf('l.flowcrypt.com') !== -1 || url.indexOf('127.0.0.1') !== -1) {
      env = 'web:local';
    } else if (url.indexOf('cryptup.org') !== -1 || url.indexOf('flowcrypt.com') !== -1) {
      env = 'web:prod';
    } else if (/chrome-extension:\/\/[a-z]{32}\/.+/.test(url)) {
      env = 'ex:fork';
    } else if (url.indexOf('mail.google.com') !== -1) {
      env = 'ex:script:gmail';
    } else if (url.indexOf('inbox.google.com') !== -1) {
      env = 'ex:script:inbox';
    } else if (/moz-extension:\/\/.+/.test(url)) {
      env = 'ex';
    }
    return browser_name + ':' + env;
  }

  public static test = () => {
    // @ts-ignore - intentional exception
    this_will_fail();
  }

  public static promise_error_alert = (note: string) => (error: Error) => { // returns a function
    console.log(error);
    alert(note);
  }

  public static stack_trace = (): string => {
    try {
      Catch.test();
    } catch (e) {
      return e.stack.split('\n').splice(3).join('\n'); // return stack after removing first 3 lines
    }
    return ''; // make ts happy - this will never happen
  }

  public static rejection = (e: PromiseRejectionEvent|t.StandardError|Error) => {
    if(!(e instanceof UnreportableError)) {
      if (e && typeof e === 'object' && e.hasOwnProperty('reason') && typeof (e as PromiseRejectionEvent).reason === 'object' && (e as PromiseRejectionEvent).reason && (e as PromiseRejectionEvent).reason.message) {
        Catch.handle_exception((e as PromiseRejectionEvent).reason); // actual exception that happened in Promise, unhandled
      } else if (!Value.is(JSON.stringify(e)).in(['{"isTrusted":false}', '{"isTrusted":true}'])) {  // unrelated to FlowCrypt, has to do with JS-initiated clicks/events
        if (typeof e === 'object' && typeof (e as t.StandardError).stack === 'string' && (e as t.StandardError).stack) { // thrown object that has a stack attached
          let stack = (e as t.StandardError).stack;
          delete (e as t.StandardError).stack;
          Catch.report('unhandled_promise_reject_object with stack', `${JSON.stringify(e)}\n\n${stack}`);
        } else {
          Catch.report('unhandled_promise_reject_object', e); // some x that was called with reject(x) and later not handled
        }
      }
    }
  }

  public static set_interval = (cb: () => void, ms: number): number => {
    return window.setInterval(Catch.try(cb), ms); // error-handled: else setInterval will silently swallow errors
  }

  public static set_timeout = (cb: () => void, ms: number): number => {
    return window.setTimeout(Catch.try(cb), ms); // error-handled: else setTimeout will silently swallow errors
  }

  public static initialize = () => {
    let figure_out_flowcrypt_runtime = () => {
      if ((window as t.FcWindow).is_bare_engine !== true) {
        try {
          Catch.RUNTIME.version = chrome.runtime.getManifest().version;
        } catch (err) {} // tslint:disable-line:no-empty
        Catch.RUNTIME.environment = Catch.environment();
        if (!Env.is_background_page() && Env.is_extension()) {
          BrowserMsg.send_await(null, 'runtime', null).then(extension_runtime => {
            if (typeof extension_runtime !== 'undefined') {
              Catch.RUNTIME = extension_runtime;
            } else {
              Catch.set_timeout(figure_out_flowcrypt_runtime, 200);
            }
          }).catch(Catch.rejection);
        }
      }
    };
    figure_out_flowcrypt_runtime();
    (window as t.FcWindow).onerror = (Catch.handle_error as ErrorEventHandler);
    (window as t.FcWindow).onunhandledrejection = Catch.rejection;
  }

}

export class Value {

  public static arr = {
    unique: <T extends FlatTypes>(array: T[]): T[] => {
      let unique: T[] = [];
      for (let v of array) {
        if (!Value.is(v).in(unique)) {
          unique.push(v);
        }
      }
      return unique;
    },
    from_dom_node_list: (obj: NodeList|JQuery<HTMLElement>): Node[] => { // http://stackoverflow.com/questions/2735067/how-to-convert-a-dom-node-list-to-an-array-in-javascript
      let array = [];
      for (let i = obj.length >>> 0; i--;) { // iterate backwards ensuring that length is an UInt32
        array[i] = obj[i];
      }
      return array;
    },
    without_key: <T>(array: T[], i: number) => array.splice(0, i).concat(array.splice(i + 1, array.length)),
    without_value: <T>(array: T[], without_value: T) => {
      let result: T[] = [];
      for (let value of array) {
        if (value !== without_value) {
          result.push(value);
        }
      }
      return result;
    },
    contains: <T>(arr: T[]|string, value: T): boolean => Boolean(arr && typeof arr.indexOf === 'function' && (arr as any[]).indexOf(value) !== -1),
    sum: (arr: number[]) => arr.reduce((a, b) => a + b, 0),
    average: (arr: number[]) => Value.arr.sum(arr) / arr.length,
    zeroes: (length: number): number[] => new Array(length).map(() => 0),
  };

  public static obj = {
    key_by_value: <T>(obj: t.Dict<T>, v: T) => {
      for (let k of Object.keys(obj)) {
        if (obj[k] === v) {
          return k;
        }
      }
    },
  };

  public static int = {
    random: (min_value: number, max_value: number) => min_value + Math.round(Math.random() * (max_value - min_value)),
    get_future_timestamp_in_months: (months_to_add: number) => new Date().getTime() + 1000 * 3600 * 24 * 30 * months_to_add,
    hours_as_miliseconds: (h: number) =>  h * 1000 * 60 * 60,
  };

  public static noop = (): void => undefined;

  public static is = (v: FlatTypes) => ({in: (array_or_str: FlatTypes[]|string): boolean => Value.arr.contains(array_or_str, v)});  // Value.this(v).in(array_or_string)

}

(( /* EXTENSIONS AND CONFIG */ ) => {

  if (typeof openpgp === 'object' && openpgp && typeof openpgp.config === 'object') {
    openpgp.config.versionstring = `FlowCrypt ${Catch.version() || ''} Gmail Encryption`;
    openpgp.config.commentstring = 'Seamlessly send and receive encrypted email';
    // openpgp.config.require_uid_self_cert = false;
  }

  String.prototype.repeat = String.prototype.repeat || function(count) {
    if (this == null) {
      throw new TypeError('can\'t convert ' + this + ' to object');
    }
    let str = '' + this;
    count = +count;
    if (count !== count) {
      count = 0;
    }
    if (count < 0) {
      throw new RangeError('repeat count must be non-negative');
    }
    if (count === Infinity) {
      throw new RangeError('repeat count must be less than infinity');
    }
    count = Math.floor(count);
    if (str.length === 0 || count === 0) {
      return '';
    }
    // Ensuring count is a 31-bit integer allows us to heavily optimize the
    // main part. But anyway, most current (August 2014) browsers can't handle
    // strings 1 << 28 chars or longer, so:
    if (str.length * count >= 1 << 28) {
      throw new RangeError('repeat count must not overflow maximum string size');
    }
    let rpt = '';
    for (;;) {
      if ((count & 1) === 1) {
        rpt += str;
      }
      count >>>= 1;
      if (count === 0) {
        break;
      }
      str += str;
    }
    // Could we try:
    // return Array(count + 1).join(this);
    return rpt;
  };

})();

Catch.initialize();
