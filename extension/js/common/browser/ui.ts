/* ©️ 2016 - present FlowCrypt a.s. Limitations apply. Contact human@flowcrypt.com */

'use strict';

import { ApiErr } from '../api/error/api-error.js';
import { Catch } from '../platform/catch.js';
import { Dict } from '../core/common.js';
import Swal from 'sweetalert2';
import { Xss } from '../platform/xss.js';

type NamedSels = Dict<JQuery<HTMLElement>>;
type ProvidedEventHandler = (e: HTMLElement, event: JQuery.Event<HTMLElement, null>) => void | Promise<void>;

export type SelCache = { cached: (name: string) => JQuery<HTMLElement>; now: (name: string) => JQuery<HTMLElement>; sel: (name: string) => string; };
export interface JQS extends JQueryStatic { featherlight: (contentOrSettings: string | Object) => void; } // tslint:disable-line:ban-types
export type PreventableEventName = 'double' | 'parallel' | 'spree' | 'slowspree' | 'veryslowspree';
export type BrowserEventErrHandler = { auth?: () => Promise<void>, authPopup?: () => Promise<void>, network?: () => Promise<void>, other?: (e: any) => Promise<void> };

export class Ui {

  public static EVENT_DOUBLE_MS = 1000;
  public static EVENT_SPREE_MS = 50;
  public static EVENT_SLOW_SPREE_MS = 200;
  public static EVENT_VERY_SLOW_SPREE_MS = 500;

  public static event = {
    clicked: (selector: string | JQuery<HTMLElement>): Promise<HTMLElement> => new Promise(resolve => $(selector as string).one('click', function () { resolve(this); })),
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
    handle: (cb: ProvidedEventHandler, errHandlers?: BrowserEventErrHandler, originalThis?: unknown) => {
      return function uiEventHandle(this: HTMLElement, event: JQuery.Event<HTMLElement, null>) {
        try {
          const r = cb.bind(originalThis)(this, event) as void | Promise<void>; // tslint:disable-line:no-unsafe-any
          if (typeof r === 'object' && typeof r.catch === 'function') { // tslint:disable-line:no-unbound-method - only testing if exists
            r.catch(e => Ui.event._dispatchErr(e, errHandlers));
          }
        } catch (e) {
          Ui.event._dispatchErr(e, errHandlers);
        }
      };
    },
    _dispatchErr: (e: any, errHandlers?: BrowserEventErrHandler) => {
      if (ApiErr.isNetErr(e) && errHandlers && errHandlers.network) {
        errHandlers.network().catch(Catch.reportErr);
      } else if (ApiErr.isAuthErr(e) && errHandlers && errHandlers.auth) {
        errHandlers.auth().catch(Catch.reportErr);
      } else if (ApiErr.isAuthPopupNeeded(e) && errHandlers && errHandlers.authPopup) {
        errHandlers.authPopup().catch(Catch.reportErr);
      } else if (errHandlers && errHandlers.other) {
        errHandlers.other(e).catch(Catch.reportErr);
      } else {
        Catch.reportErr(e);
      }
    },
    prevent: <THIS extends HTMLElement | void>(
      evName: PreventableEventName, cb: (el: HTMLElement, resetTimer: () => void) => void | Promise<void>, errHandler?: BrowserEventErrHandler, originalThis?: unknown
    ) => {
      let eventTimer: number | undefined;
      let eventFiredOn: number | undefined;
      const cbResetTimer = () => {
        eventTimer = undefined;
        eventFiredOn = undefined;
      };
      const cbWithErrsHandled = (el: HTMLElement) => {
        try {
          const r = cb.bind(originalThis)(el, cbResetTimer) as void | Promise<void>; // tslint:disable-line:no-unsafe-any
          if (typeof r === 'object' && typeof r.catch === 'function') { // tslint:disable-line:no-unbound-method - only testing if exists
            r.catch(e => Ui.event._dispatchErr(e, errHandler));
          }
        } catch (e) {
          Ui.event._dispatchErr(e, errHandler);
        }
      };
      return function (this: THIS) {
        if (evName === 'spree') {
          clearTimeout(eventTimer);
          eventTimer = Catch.setHandledTimeout(() => cbWithErrsHandled(this as HTMLElement), Ui.EVENT_SPREE_MS);
        } else if (evName === 'slowspree') {
          clearTimeout(eventTimer);
          eventTimer = Catch.setHandledTimeout(() => cbWithErrsHandled(this as HTMLElement), Ui.EVENT_SLOW_SPREE_MS);
        } else if (evName === 'veryslowspree') {
          clearTimeout(eventTimer);
          eventTimer = Catch.setHandledTimeout(() => cbWithErrsHandled(this as HTMLElement), Ui.EVENT_VERY_SLOW_SPREE_MS);
        } else {
          if (eventFiredOn) {
            if (evName === 'parallel') {
              // event handling is still being processed. Do not call back
            } else if (evName === 'double') {
              if (Date.now() - eventFiredOn > Ui.EVENT_DOUBLE_MS) {
                eventFiredOn = Date.now();
                cbWithErrsHandled(this as HTMLElement);
              }
            }
          } else {
            eventFiredOn = Date.now();
            cbWithErrsHandled(this as HTMLElement);
          }
        }
      };
    }
  };

  public static time = {
    wait: (untilThisFunctionEvalsTrue: () => boolean | undefined) => new Promise((success, error) => {
      const interval = Catch.setHandledInterval(() => {
        const result = untilThisFunctionEvalsTrue();
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
    sleep: (ms: number, setCustomTimeout: (code: () => void, t: number) => void = Catch.setHandledTimeout) => new Promise(resolve => setCustomTimeout(resolve, ms)),
  };

  public static modal = {
    info: async (text: string): Promise<void> => {
      await Swal.fire({
        html: Xss.escape(text).replace(/\n/g, '<br>'),
        animation: false,
        scrollbarPadding: false,
        allowOutsideClick: false,
        customClass: {
          popup: 'ui-modal-info',
          confirmButton: 'ui-modal-info-confirm',
        },
      });
    },
    warning: async (text: string, footer?: string): Promise<void> => {
      await Swal.fire({
        html: `<span class="orange">${Xss.escape(text).replace(/\n/g, '<br>')}</span>`,
        footer: footer ? Xss.htmlSanitize(footer) : '',
        animation: false,
        scrollbarPadding: false,
        allowOutsideClick: false,
        customClass: {
          popup: 'ui-modal-warning',
          confirmButton: 'ui-modal-warning-confirm',
        },
      });
    },
    error: async (text: string, isHTML: boolean = false, footer?: string): Promise<void> => {
      text = isHTML ? Xss.htmlSanitize(text) : Xss.escape(text).replace(/\n/g, '<br>');
      await Swal.fire({
        html: `<span class="red">${text}</span>`,
        footer: footer ? Xss.htmlSanitize(footer) : '',
        animation: false,
        scrollbarPadding: false,
        allowOutsideClick: false,
        customClass: {
          popup: 'ui-modal-error',
          confirmButton: 'ui-modal-error-confirm',
        },
      });
    },
    confirm: async (text: string): Promise<boolean> => {
      const { dismiss } = await Swal.fire({
        html: Xss.escape(text).replace(/\n/g, '<br>'),
        animation: false,
        scrollbarPadding: false,
        allowOutsideClick: false,
        showCancelButton: true,
        customClass: {
          popup: 'ui-modal-confirm',
          confirmButton: 'ui-modal-confirm-confirm',
          cancelButton: 'ui-modal-confirm-cancel',
        },
      });
      return typeof dismiss === 'undefined';
    },
    confirmWithCheckbox: async (label: string, html: string = ''): Promise<boolean> => {
      const { dismiss } = await Swal.fire({
        html,
        input: 'checkbox',
        inputPlaceholder: label,
        animation: false,
        scrollbarPadding: false,
        allowOutsideClick: false,
        customClass: {
          popup: 'ui-modal-confirm-checkbox',
          confirmButton: 'ui-modal-confirm-checkbox-confirm',
          cancelButton: 'ui-modal-confirm-checkbox-cancel',
          input: 'ui-modal-confirm-checkbox-input',
        },
        onOpen: () => {
          const input = Swal.getInput();
          const confirmButton = Swal.getConfirmButton();
          $(confirmButton).prop('disabled', true);
          $(input).on('change', () => {
            $(confirmButton).prop('disabled', !input.checked);
          });
        }
      });
      return typeof dismiss === 'undefined';
    },
  };

  public static testCompatibilityLink = '<a href="/chrome/settings/modules/compatibility.htm" target="_blank">Test your OpenPGP key compatibility</a>';

  public static retryLink = (caption: string = 'retry') => {
    return `<a href="${Xss.escape(window.location.href)}" data-test="action-retry-by-reloading">${Xss.escape(caption)}</a>`;
  }

  public static delay = async (ms: number) => {
    return await new Promise(resolve => Catch.setHandledTimeout(resolve, ms));
  }

  public static spinner = (color: string, placeholderCls: "small_spinner" | "large_spinner" = 'small_spinner') => {
    const path = `/img/svgs/spinner-${color}-small.svg`;
    const url = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL ? chrome.runtime.getURL(path) : path;
    return `<i class="${placeholderCls}" data-test="spinner"><img src="${url}" /></i>`;
  }

  public static renderOverlayPromptAwaitUserChoice = async (btns: Dict<{ title?: string, color?: string }>, prompt: string, details?: string): Promise<string> => {
    return await new Promise(resolve => {
      const getEscapedColor = (id: string) => Xss.escape(btns[id].color || 'green');
      const getEscapedTitle = (id: string) => Xss.escape(btns[id].title || id.replace(/_/g, ' '));
      const formatBtn = (id: string) => {
        return `<button class="button ${getEscapedColor(id)} overlay_action_${Xss.escape(id)}" data-test="action-overlay-${Xss.escape(id)}">${getEscapedTitle(id)}</button>`;
      };
      const formattedBtns = Object.keys(btns).map(formatBtn).join('&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;');
      if (details) {
        const a = `<a href="#" class="action-show-overlay-details" data-test="action-show-overlay-details" style="display:block;text-align:center;">Show technical details</a>`;
        details = `${a}<pre style="font-size:10px;width:900px;overflow-x: scroll;" class="display_none" data-test="container-overlay-details">${details.replace(/\n/g, '<br>')}</pre>`;
      }
      Xss.sanitizeAppend('body', `
        <div class="featherlight white prompt_overlay" style="display: block;">
          <div class="featherlight-content" data-test="dialog">
            <div class="line" data-test="container-overlay-prompt-text">${prompt.replace(/\n/g, '<br>')}</div>
            <div class="line">${formattedBtns}</div>
            <div class="line">&nbsp;</div>
            <div style="font-size:12px;">${details || ''}</div>
            <div class="line">&nbsp;</div>
            <div class="line">Email human@flowcrypt.com if you need assistance.</div>
          </div>
        </div>
      `);
      const overlay = $('.prompt_overlay');
      overlay.find('.action-show-overlay-details').one('click', Ui.event.handle(target => {
        $(target).hide().siblings('pre').show();
      }));
      for (const id of Object.keys(btns)) {
        overlay.find(`.overlay_action_${id}`).one('click', Ui.event.handle(() => {
          overlay.remove();
          resolve(id);
        }));
      }
    });
  }

  public static escape = (callback: () => void) => {
    return (e: JQuery.Event<HTMLElement, null>) => { // returns a function
      if (!e.metaKey && !e.ctrlKey && e.key === 'Escape') {
        callback();
      }
    };
  }

  public static tab = (callback: (e: JQuery.Event<HTMLElement>) => void) => {
    return (e: JQuery.Event<HTMLElement>) => { // returns a function
      if (!e.metaKey && !e.ctrlKey && !e.shiftKey && e.key === 'Tab') {
        callback(e);
      }
    };
  }

  public static shiftTab = (callback: (e: JQuery.Event<HTMLElement>) => void) => {
    return (e: JQuery.Event<HTMLElement>) => { // returns a function
      if (!e.metaKey && !e.ctrlKey && e.shiftKey && e.key === 'Tab') {
        callback(e);
      }
    };
  }

  public static enter = (callback: () => void) => {
    return (e: JQuery.Event<HTMLElement, null>) => { // returns a function
      if (!e.metaKey && !e.ctrlKey && e.key === 'Enter') {
        callback();
      }
    };
  }

  public static ctrlEnter = (callback: () => void) => {
    return (e: JQuery.Event<HTMLElement, null>) => { // returns a function
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        callback();
      }
    };
  }

  public static setTestState = (state: 'ready' | 'working' | 'waiting') => {
    $('body').attr('data-test-state', state); // for automated tests
  }

  public static buildJquerySels = (sels: Dict<string>): SelCache => {
    const cache: NamedSels = {};
    return {
      cached: (name: string) => {
        if (!cache[name]) {
          if (typeof sels[name] === 'undefined') {
            Catch.report('unknown selector name: ' + name);
          }
          cache[name] = $(sels[name]);
        }
        return cache[name];
      },
      now: (name: string) => {
        if (typeof sels[name] === 'undefined') {
          Catch.report('unknown selector name: ' + name);
        }
        return $(sels[name]);
      },
      sel: (name: string) => {
        if (typeof sels[name] === 'undefined') {
          Catch.report('unknown selector name: ' + name);
        }
        return sels[name];
      }
    };
  }

  public static scroll = (sel: string | JQuery<HTMLElement>, repeat: number[] = []) => {
    const el = $(sel as string).first()[0]; // as string due to JQuery TS quirk. Do not convert to String() as this may actually be JQuery<HTMLElement>
    if (el) {
      el.scrollIntoView();
      for (const delay of repeat) { // useful if mobile keyboard is about to show up
        Catch.setHandledTimeout(() => el.scrollIntoView(), delay);
      }
    }
  }

  public static e(name: string, attrs: Dict<string>) {
    return $(`<${name}/>`, attrs)[0].outerHTML; // xss-tested: jquery escapes attributes
  }

  public static toast = async (msg: string, seconds = 2): Promise<void> => {
    await Swal.fire({
      toast: true,
      title: msg,
      showConfirmButton: false,
      animation: false,
      position: 'bottom',
      timer: seconds * 1000,
      customClass: {
        popup: 'ui-toast',
        title: 'ui-toast-title'
      }
    });
  }
}
