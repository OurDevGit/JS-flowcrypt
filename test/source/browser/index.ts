/* ©️ 2016 - present FlowCrypt a.s. Limitations apply. Contact human@flowcrypt.com */

export { BrowserHandle } from './browser-handle';
export { BrowserPool, Semaphore } from './browser-pool';
export { Controllable, ControllablePage, ControllableFrame } from './controllable';
export { TestUrls as Urls } from './test-urls';

export const TIMEOUT_ELEMENT_GONE = 20;
export const TIMEOUT_ELEMENT_APPEAR = 20;
export const TIMEOUT_FOCUS = 20;
export const TIMEOUT_PAGE_LOAD = 40;
export const TIMEOUT_TEST_STATE_SATISFY = 15;
export const TIMEOUT_DESTROY_UNEXPECTED_ALERT = 3;
