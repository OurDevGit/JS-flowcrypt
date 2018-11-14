/* © 2016-2018 FlowCrypt Limited. Limitations apply. Contact human@flowcrypt.com */

'use strict';

import { Value } from '../../common/common.js';
import { FlowCryptManifest, BrowserMsg, GoogleAuthWindowResult$result } from '../../common/extension.js';
import { Ui, Env } from '../../common/browser.js';
import { AuthReq } from '../../common/api/google.js';

(async () => {

  const googleOauth2 = (chrome.runtime.getManifest() as any as FlowCryptManifest).oauth2;

  const apiGoogleAuthStateUnpack = (statusString: string): AuthReq => {
    return JSON.parse(statusString.replace(googleOauth2.state_header, '')) as AuthReq; // todo - maybe can check with a type guard and throw if not
  };

  while (true) {
    if (document.title && Value.is(googleOauth2.state_header).in(document.title)) { // this is FlowCrypt's google oauth - based on a &state= passed on in auth request
      const parts = document.title.split(' ', 2);
      const result = parts[0];
      const params = Env.urlParams(['code', 'state', 'error'], parts[1]);
      const state = apiGoogleAuthStateUnpack(params.state as string);
      await BrowserMsg.send.await.googleAuthWindowResult(state.tabId, {
        result: result as GoogleAuthWindowResult$result,
        params: {
          code: String(params.code),
          error: String(params.error),
        },
        state,
      });
      const title = 'Close this window';
      $('title').text(title);
      BrowserMsg.send.bg.closePopup({ title });
      break;
    }
    await Ui.time.sleep(50);
  }

})().catch(console.error);
