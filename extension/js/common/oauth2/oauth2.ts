/* ©️ 2016 - present FlowCrypt a.s. Limitations apply. Contact human@flowcrypt.com */

import { Bm, BrowserMsg } from '../browser/browser-msg.js';
import { windowsCreate } from '../browser/chrome.js';

export class OAuth2 {
  public static webAuthFlow = async (url: string): Promise<Bm.AuthWindowResult> => {
    const screenWidth = window.screen.width || window.innerWidth;
    const screenHeight = window.screen.height || window.innerHeight;
    // non-standard but supported by most of the browsers
    const { availLeft, availTop } = window.screen as unknown as { availLeft?: number; availTop?: number };
    let adaptiveWidth = Math.floor(screenWidth * 0.4);
    if (adaptiveWidth < 550) {
      adaptiveWidth = Math.min(550, Math.floor(screenWidth * 0.9));
    }
    const adaptiveHeight = Math.floor(screenHeight * 0.9);
    const leftOffset = Math.floor(screenWidth / 2 - adaptiveWidth / 2 + (availLeft || 0));
    const topOffset = Math.floor(screenHeight / 2 - adaptiveHeight / 2 + (availTop || 0));
    const oauthWin = await windowsCreate({
      url,
      left: leftOffset,
      top: topOffset,
      height: adaptiveHeight,
      width: adaptiveWidth,
      type: 'popup',
    });
    if (!oauthWin || !oauthWin.tabs || !oauthWin.tabs.length || !oauthWin.id) {
      return { error: 'No oauth window returned after initiating it' };
    }
    const tabId = oauthWin?.tabs && oauthWin.tabs[0].id;
    return await new Promise(resolve => {
      // need to use chrome.runtime.onMessage because BrowserMsg.addListener doesn't work
      // In gmail page reconnect auth popup, it sends event to background page (BrowserMsg.send.bg.await.reconnectAcctAuthPopup)
      // thefore BrowserMsg.addListener doesn't work
      chrome.runtime.onMessage.addListener((message: Bm.Raw) => {
        if (message.name === 'auth_window_result') {
          void chrome.tabs.remove(tabId!); // eslint-disable-line @typescript-eslint/no-non-null-assertion
          resolve(message.data.bm as Bm.AuthWindowResult);
        }
      });
      chrome.tabs.onRemoved.addListener(removedTabId => {
        // Only reject error when auth result not successful
        if (removedTabId === tabId) {
          resolve({ error: 'Canceled by user' });
        }
      });
    });
  };

  public static finishAuth = (url: string) => {
    BrowserMsg.send.authWindowResult('broadcast', { url });
  };
}
