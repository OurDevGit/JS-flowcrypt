import { AvaContext, newTimeoutPromise } from '../tests';
import { ConsoleMessage, Dialog, ElementHandle, Frame, Page } from 'puppeteer';
import { TIMEOUT_DESTROY_UNEXPECTED_ALERT, TIMEOUT_ELEMENT_APPEAR, TIMEOUT_ELEMENT_GONE, TIMEOUT_PAGE_LOAD, TIMEOUT_TEST_STATE_SATISFY } from '.';

import { TestUrls } from './test_urls';
import { Util } from '../util';
import { expect } from 'chai';

declare const jQuery: any;

abstract class ControllableBase {

  public target: Page | Frame;
  private debugNamespace: string | undefined = undefined;

  constructor(pageOrFrame: Page | Frame) {
    this.target = pageOrFrame;
  }

  public enable_debugging(namespace: string) {
    this.debugNamespace = namespace;
  }

  protected log = (msg: string) => {
    if (this.debugNamespace) {
      console.info(`[debug][controllable][${this.debugNamespace}] ${msg}`);
    }
  }

  protected isXpath = (selector: string): boolean => {
    return selector.match(/^\/\//) !== null;
  }

  protected selector = (customSelLanguageQuery: string): string => { // supply browser selector, xpath, @test-id or @test-id(contains this text)
    let m: RegExpMatchArray | null;
    if (this.isXpath(customSelLanguageQuery)) {
      return customSelLanguageQuery;
      // eslint-disable-next-line no-cond-assign
    } else if (m = customSelLanguageQuery.match(/@(ui-modal-[a-z\-]+)\:message/)) { // tslint:disable-line:no-conditional-assignment
      return `.${m[1]} #swal2-content`; // message inside the modal
      // eslint-disable-next-line no-cond-assign
    } else if (m = customSelLanguageQuery.match(/@(ui-modal-[a-z\-]+)/)) { // tslint:disable-line:no-conditional-assignment
      return `.${m[1]}`; // represented as a class
      // eslint-disable-next-line no-cond-assign
    } else if (m = customSelLanguageQuery.match(/^@([a-z0-9\-]+)$/)) { // tslint:disable-line:no-conditional-assignment
      return `[data-test="${m[1]}"]`;
      // eslint-disable-next-line no-cond-assign
    } else if (m = customSelLanguageQuery.match(/^@([a-z0-9\-]+)\(([^()]*)\)$/)) { // tslint:disable-line:no-conditional-assignment
      return `//*[@data-test='${m[1]}' and contains(text(),'${m[2]}')]`;
    } else {
      return customSelLanguageQuery;
    }
  }

  protected element = async (selector: string): Promise<ElementHandle | null> => {
    selector = this.selector(selector);
    if (this.isXpath(selector)) {
      return (await this.target.$x(selector))[0];
    } else {
      return await this.target.$(selector);
    }
  }

  public isElementPresent = async (selector: string) => {
    return Boolean(await this.element(selector));
  }

  protected selsAsProcessedArr = (selector: string | string[]): string[] => {
    return (Array.isArray(selector) ? selector : [selector]).map(this.selector);
  }

  public waitForSelTestState = async (state: 'ready' | 'working' | 'waiting' | 'closed', timeout = TIMEOUT_TEST_STATE_SATISFY) => {
    await this.waitAll(`[data-test-state="${state}"]`, { timeout, visible: false });
  }

  public attr = async (elHandle: ElementHandle, name: string): Promise<string> => {
    return await (await elHandle.getProperty(name)).jsonValue();
  }

  public waitAll = async (selector: string | string[], { timeout = TIMEOUT_ELEMENT_APPEAR, visible = true }: { timeout?: number, visible?: boolean } = {}) => {
    const selectors = this.selsAsProcessedArr(selector);
    this.log(`wait_all:1:${selectors.join(',')}`);
    for (const selector of selectors) {
      this.log(`wait_all:2:${selector}`);
      if (this.isXpath(selector)) {
        this.log(`wait_all:3:${selector}`);
        await this.target.waitForXPath(selector, { timeout: timeout * 1000, visible });
        this.log(`wait_all:4:${selector}`);
      } else {
        this.log(`wait_all:5:${selector}`);
        await this.target.waitForSelector(selector, { timeout: timeout * 1000, visible });
        this.log(`wait_all:6:${selector}`);
      }
    }
    this.log(`wait_all:7:${selectors.join(',')}`);
  }

  public waitAny = async (selector: string | string[], { timeout = TIMEOUT_ELEMENT_APPEAR, visible = true }: { timeout?: number, visible?: boolean } = {}): Promise<ElementHandle> => {
    timeout = Math.max(timeout, 1);
    const selectors = this.selsAsProcessedArr(selector);
    while (timeout-- > 0) {
      try {
        for (const selector of selectors) {
          const elements = await (this.isXpath(selector) ? this.target.$x(selector) : this.target.$$(selector));
          for (const element of elements) {
            if ((await element.boundingBox()) !== null || !visible) { // element is visible
              return element;
            }
          }
        }
      } catch (e) {
        if (e instanceof Error && e.message.indexOf('Cannot find context with specified id undefined') === -1) {
          throw e;
        }
      }
      await Util.sleep(0.5);
    }
    throw Error(`waiting failed: Elements did not appear: ${selectors.join(',')}`);
  }

  public waitTillGone = async (selector: string | string[], { timeout = TIMEOUT_ELEMENT_GONE }: { timeout?: number } = {}) => {
    let secondsLeft = typeof timeout !== 'undefined' ? timeout : TIMEOUT_ELEMENT_GONE;
    const selectors = Array.isArray(selector) ? selector : [selector];
    while (secondsLeft-- >= 0) {
      try {
        await this.waitAny(selectors, { timeout: 0 }); // if this fails, that means there are none left: return success
        await Util.sleep(1);
      } catch (e) {
        if (e.message.indexOf('waiting failed') === 0) {
          return;
        }
      }
    }
    throw Error(`this.wait_till_gone: some of "${selectors.join(',')}" still present after timeout:${timeout}`);
  }

  public notPresent = async (selector: string | string[]) => {
    return await this.waitTillGone(selector, { timeout: 0 });
  }

  public click = async (selector: string) => {
    this.log(`click:1:${selector}`);
    const e = await this.element(selector);
    this.log(`click:2:${selector}`);
    if (!e) {
      throw Error(`Element not found: ${selector}`);
    }
    this.log(`click:4:${selector}`);
    try {
      await e.click();
    } catch (e) {
      if (e instanceof Error) {
        e.stack += ` SELECTOR: ${selector}`;
        await Util.sleep(60);
      }
      throw e;
    }
    this.log(`click:5:${selector}`);
  }

  public type = async (selector: string, text: string, letterByLetter = false) => {
    const e = await this.element(selector);
    if (!e) {
      throw Error(`Element not found: ${selector}`);
    }
    if (letterByLetter || text.length < 10) {
      await e.type(text);
    } else {
      const typeLastTenChars = await this.target.evaluate((s, t) => {
        const el = document.querySelector(s);
        if (el.contentEditable === 'true') {
          el.innerText = t;
          el.selectionEnd = el.innerText.length;
          el.selectionStart = el.innerText.length;
          return false;
        }
        el.value = t.substring(0, t.length - 5);
        if (el.type !== 'email' && typeof el.value !== 'undefined') {
          el.selectionEnd = el.value.length;
          el.selectionStart = el.value.length;
        }
        return true;
      }, this.selector(selector), text);
      if (typeLastTenChars) { // used to simulate typing events
        await e.type(text.substring(text.length - 5, text.length));
      }
    }
  }

  public value = async (selector: string): Promise<string> => {
    return await this.target.evaluate((s) => {
      const e = document.querySelector(s); // this will get evaluated in the browser
      if (e.tagName === 'SELECT') {
        return e.options[e.selectedIndex].value;
      } else {
        return e.value;
      }
    }, this.selector(selector));
  }

  public isDisabled = async (selector: string): Promise<boolean> => {
    return await this.target.evaluate((s) => document.querySelector(s).disabled, this.selector(selector));
  }

  public isChecked = async (selector: string): Promise<boolean> => {
    return await this.target.evaluate((s) => document.querySelector(s).checked, this.selector(selector));
  }

  // Get the current computed outer height (including padding, border)
  public getOuterHeight = async (selector: string): Promise<string> => {
    return await this.target.evaluate((s) => {
      const computedStyle = getComputedStyle(document.querySelector(s));
      const paddings = parseInt(computedStyle.getPropertyValue('padding-top')) + parseInt(computedStyle.getPropertyValue('padding-bottom'));
      const border = parseInt(computedStyle.getPropertyValue('border-top-width')) + parseInt(computedStyle.getPropertyValue('border-bottom-width'));
      let outerHeight = parseInt(computedStyle.getPropertyValue('height')) + paddings + border;
      return outerHeight;
    }, this.selector(selector));
  }

  public read = async (selector: string, onlyVisible = false): Promise<string> => {
    selector = this.selector(selector);
    if (onlyVisible) {
      return await this.target.evaluate((s) => [].slice.call(document.querySelectorAll(s)).find((el: HTMLElement) => el.offsetParent !== null).innerText, selector);
    } else {
      return await this.target.evaluate((s) => document.querySelector(s).innerText, selector);
    }
  }

  public selectOption = async (selector: string, choice: string) => {
    await this.target.evaluate((s, v) => jQuery(s).val(v).trigger('change'), this.selector(selector), choice);
  }

  public waitAndType = async (selector: string, text: string, { delay = 0.1 }: { delay?: number } = {}) => {
    await this.waitAll(selector);
    await Util.sleep(delay);
    await this.type(selector, text);
  }

  public waitAndRespondToModal = async (type: 'info' | 'warning' | 'error' | 'confirm' | 'confirm-checkbox', clickBtn: 'confirm' | 'cancel', message: string) => {
    await this.waitAll([`@ui-modal-${type}`, `@ui-modal-${type}:message`]);
    await Util.sleep(0.5);
    expect(await this.read(`@ui-modal-${type}:message`)).to.contain(message, `ui-modal-${type}:message does not contain expected text`);
    if (type === 'confirm-checkbox') {
      await this.waitAndClick(`@ui-modal-${type}-input`);
    }
    await this.waitAndClick(`@ui-modal-${type}-${clickBtn}`);
  }

  public waitAndClick = async (selector: string, { delay = 0.1, confirmGone = false, retryErrs = false, sleepWhenDone }:
    { delay?: number, confirmGone?: boolean, retryErrs?: boolean, sleepWhenDone?: number } = {}) => {
    for (const i of [1, 2, 3]) {
      this.log(`wait_and_click(i${i}):1:${selector}`);
      await this.waitAll(selector);
      this.log(`wait_and_click(i${i}):2:${selector}`);
      await Util.sleep(delay);
      this.log(`wait_and_click(i${i}):3:${selector}`);
      try {
        this.log(`wait_and_click(i${i}):4:${selector}`);
        await this.click(selector);
        this.log(`wait_and_click(i${i}):5:${selector}`);
        break;
      } catch (e) {
        this.log(`wait_and_click(i${i}):6:err(${String(e)}):${selector}`);
        if (e.message === 'Node is either not visible or not an HTMLElement' || e.message === 'Node is detached from document') {
          // maybe the node just re-rendered?
          if (!retryErrs || i === 3) {
            e.stack = `[clicking(${selector}) failed because element quickly disappeared, consider adding retryErrs]\n` + e.stack;
            throw e;
          }
          this.log(`wait_and_click(i${i}):retrying`);
          await Util.sleep(1);
          continue;
        }
        throw e;
      }
    }
    if (confirmGone) {
      this.log(`wait_and_click:7:${selector}`);
      await this.waitTillGone(selector);
    }
    this.log(`wait_and_click:8:${selector}`);
    if (sleepWhenDone) {
      await Util.sleep(sleepWhenDone);
      this.log(`wait_and_click:9:${selector}`);
    }
    this.log(`wait_and_click:10:${selector}`);
  }

  public waitForContent = async (selector: string, needle: string, timeoutSec = 20, testLoopLengthMs = 100) => {
    await this.waitAll(selector);
    const start = Date.now();
    let text = '';
    while (Date.now() - start < timeoutSec * 1000) {
      text = await this.read(selector, true);
      if (text.includes(needle)) {
        return;
      }
      await Util.sleep(testLoopLengthMs / 1000);
    }
    throw new Error(`Slector ${selector} was found but did not contain text "${needle}" whithin ${timeoutSec}s. Last content: "${text}"`);
  }

  private getFramesUrlsInThisMoment = async (urlMatchables: string[]) => {
    const matchingLinks: string[] = [];
    for (const iframe of await this.target.$$('iframe')) {
      const srcHandle = await iframe.getProperty('src');
      const src = await srcHandle.jsonValue() as string;
      if (urlMatchables.filter(m => src.indexOf(m) !== -1).length === urlMatchables.length) {
        matchingLinks.push(src);
      }
    }
    return matchingLinks;
  }

  public getFramesUrls = async (urlMatchables: string[], { sleep, appearIn }: { sleep?: number, appearIn?: number } = { sleep: 3 }): Promise<string[]> => {
    if (sleep) {
      await Util.sleep(sleep);
    }
    if (!appearIn) {
      return await this.getFramesUrlsInThisMoment(urlMatchables);
    }
    for (let second = 0; second < appearIn; second++) {
      const matched = await this.getFramesUrlsInThisMoment(urlMatchables);
      if (matched.length) {
        return matched;
      }
      await Util.sleep(1);
    }
    throw new Error(`Could not find any frame in ${appearIn}s that matches ${urlMatchables.join(' ')}`);
  }

  public getFrame = async (urlMatchables: string[], { sleep = 1 } = { sleep: 1 }): Promise<ControllableFrame> => {
    if (sleep) {
      await Util.sleep(sleep);
    }
    let frames: Frame[];
    if (this.target.constructor.name === 'Page') {
      frames = await (this.target as Page).frames();
    } else if (this.target.constructor.name === 'Frame') {
      frames = await (this.target as Frame).childFrames();
    } else {
      throw Error(`Unknown this.target.constructor.name: ${this.target.constructor.name}`);
    }
    const frame = frames.find(frame => {
      for (const fragment of urlMatchables) {
        if (frame.url().indexOf(fragment) === -1) {
          return false;
        }
      }
      return true;
    });
    if (frame) {
      return new ControllableFrame(frame);
    }
    throw Error(`Frame not found: ${urlMatchables.join(',')}`);
  }

}

export class ControllableAlert {

  public target: Dialog;
  public active = true;

  constructor(alert: Dialog) {
    this.target = alert;
  }

  accept = async () => {
    await this.target.accept();
    this.active = false;
  }

  dismiss = async () => {
    await this.target.dismiss();
    this.active = false;
  }

}

class ConsoleEvent {
  constructor(public type: string, public text: string) { }
}

export class ControllablePage extends ControllableBase {

  public consoleMsgs: (ConsoleMessage | ConsoleEvent)[] = [];
  public alerts: ControllableAlert[] = [];
  private preventclose = false;

  constructor(public t: AvaContext, public page: Page) {
    super(page);
    page.on('console', console => {
      this.consoleMsgs.push(console);
    });
    page.on('requestfinished', r => {
      const response = r.response();
      const fail = r.failure();
      const url = r.url();
      if (url.indexOf(TestUrls.extension('')) !== 0 || fail) { // not an extension url, or a fail
        this.consoleMsgs.push(new ConsoleEvent('request', `${response ? response.status() : '-1'} ${r.method()} ${url}: ${fail ? fail.errorText : 'ok'}`));
      }
    });
    page.on('dialog', alert => {
      this.consoleMsgs.push(new ConsoleEvent('alert', alert.message()));
    });
    page.on('pageerror', error => {
      this.consoleMsgs.push(new ConsoleEvent('error', error.stack || String(error)));
    });
    // page.on('error', e => this.consoleMsgs.push(`[error]${e.stack}[/error]`)); // this is Node event emitter error. Maybe just let it go crash the process / test
    page.on('dialog', alert => {
      const controllableAlert = new ControllableAlert(alert);
      this.alerts.push(controllableAlert);
      setTimeout(() => {
        if (controllableAlert.active) {
          t.retry = true;
          this.preventclose = true;
          t.log(`${t.attemptText} Dismissing unexpected alert ${alert.message()}`);
          try {
            alert.dismiss().catch(e => t.log(`${t.attemptText} Err1 dismissing alert ${String(e)}`));
          } catch (e) {
            t.log(`${t.attemptText} Err2 dismissing alert ${String(e)}`);
          }
        }
      }, TIMEOUT_DESTROY_UNEXPECTED_ALERT * 1000);
    });
  }

  public newAlertTriggeredBy = async (triggeringAction: () => Promise<void>): Promise<ControllableAlert> => {
    const dialogPromise: Promise<ControllableAlert> = new Promise((resolve, reject) => {
      this.page.on('dialog', () => resolve(this.alerts[this.alerts.length - 1])); // we need it as a ControllableAlert so that we know if it was dismissed or not
      setTimeout(() => reject(new Error('new alert timout - no alert')), TIMEOUT_ELEMENT_APPEAR * 1000);
    });
    triggeringAction().catch(console.error);
    return await dialogPromise;
  }

  public waitForNavigationIfAny = async (seconds: number = 5) => {
    try {
      await this.page.waitForNavigation({ timeout: seconds * 1000 });
    } catch (e) {
      if (e.message.indexOf('Navigation Timeout Exceeded') === 0) {
        return;
      }
      throw e;
    }
  }

  public goto = async (url: string) => {
    url = url.indexOf('https://') === 0 || url.indexOf(TestUrls.extension('')) === 0 ? url : TestUrls.extension(url);
    // await this.page.goto(url); // may produce intermittent Navigation Timeout Exceeded in CI environment
    this.page.goto(url).catch(e => this.t.log(`goto: ${e.message}: ${url}`));
    await Promise.race([
      this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: TIMEOUT_PAGE_LOAD * 1000 }),
      this.page.waitForNavigation({ waitUntil: 'load', timeout: TIMEOUT_PAGE_LOAD * 1000 })
    ]);
  }

  public close = async () => {
    if (this.preventclose) {
      this.t.log('page.close() was called but closing was prevented because we want to evaluate earlier errors (cannot screenshot a closed page)');
      this.preventclose = false;
    } else {
      await this.page.close();
    }
  }

  private dismissActiveAlerts = async (): Promise<void> => {
    const activeAlerts = this.alerts.filter(a => a.active);
    for (const alert of activeAlerts) {
      // active alert will cause screenshot and other ops to hang: https://github.com/GoogleChrome/puppeteer/issues/2481
      try {
        await Promise.race([alert.dismiss(), newTimeoutPromise('alert dismiss', 10)]);
      } catch (e) {
        if (!(e instanceof Error && e.message === 'Cannot dismiss dialog which is already handled!')) {
          throw e;
        }
      }
    }
  }

  public screenshot = async (): Promise<string> => {
    await this.dismissActiveAlerts();
    return await Promise.race([this.page.screenshot({ encoding: 'base64' }), newTimeoutPromise('screenshot', 20)]);
  }

  public html = async (): Promise<string> => {
    await this.dismissActiveAlerts();
    return await Promise.race([this.page.content(), newTimeoutPromise('html content', 10)]);
  }

  public console = async (): Promise<string> => {
    await this.dismissActiveAlerts();
    let html = '';
    for (const msg of this.consoleMsgs) {
      if (msg instanceof ConsoleEvent) {
        html += `<font class="c-${Util.htmlEscape(msg.type)}">${Util.htmlEscape(msg.type)}: ${Util.htmlEscape(msg.text)}</font>\n`;
      } else {
        html += `<font class="c-${Util.htmlEscape(msg.type())}">${Util.htmlEscape(msg.type())}: ${Util.htmlEscape(msg.text())}`;
        const args: string[] = [];
        for (const arg of msg.args()) {
          try {
            const r = JSON.stringify(await Promise.race([arg.jsonValue(), new Promise(resolve => setTimeout(() => resolve('test.ts: log fetch timeout'), 3000))]));
            if (r !== '{}' && r && r !== JSON.stringify(msg.text())) {
              args.push(r);
            }
          } catch (e) {
            args.push(`test.ts: console msg arg err: ${String(e)}`);
          }
        }
        if (args.length) {
          html += `<ul>${args.map(arg => `<li>${Util.htmlEscape(arg)}</li>`)}</ul>`;
        }
        html += `</font>\n`;
      }
    }
    return html;
  }
}

export class ControllableFrame extends ControllableBase {

  public frame: Frame;

  constructor(frame: Frame) {
    super(frame);
    this.frame = frame;
  }

}

export type Controllable = ControllableFrame | ControllablePage;
