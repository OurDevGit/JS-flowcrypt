
/* © 2016-2018 FlowCrypt Limited. Limitations apply. Contact human@flowcrypt.com */

'use strict';

import { Store } from '../platform/store.js';
import { Ui } from '../browser.js';
import { Catch } from '../platform/catch.js';
import { Xss } from '../platform/xss.js';

export const initPassphraseToggle = async (passphraseInputIds: string[], forceInitialShowOrHide?: "show" | "hide") => {
  const buttonHide = '<img src="/img/svgs/eyeclosed-icon.svg" class="eye-closed"><br>hide';
  const buttonShow = '<img src="/img/svgs/eyeopen-icon.svg" class="eye-open"><br>show';
  const storage = await Store.getGlobal(['hide_pass_phrases']);
  let show: boolean;
  if (forceInitialShowOrHide === 'hide') {
    show = false;
  } else if (forceInitialShowOrHide === 'show') {
    show = true;
  } else {
    show = !storage.hide_pass_phrases;
  }
  for (const id of passphraseInputIds) {
    const passphraseInput = $(`#${id}`);
    passphraseInput.addClass('toggled_passphrase');
    if (show) {
      passphraseInput.after(`<label href="#" id="toggle_${id}" class="toggle_show_hide_pass_phrase" for="${id}">${buttonHide}</label>`);
      passphraseInput.attr('type', 'text');
    } else {
      passphraseInput.after(`<label href="#" id="toggle_${id}" class="toggle_show_hide_pass_phrase" for="${id}">${buttonShow}</label>`);
      passphraseInput.attr('type', 'password');
    }
    $(`#toggle_${id}`).click(Ui.event.handle(target => {
      if (passphraseInput.attr('type') === 'password') {
        $(`#${id}`).attr('type', 'text');
        Xss.sanitizeRender(target, buttonHide);
        Store.setGlobal({ hide_pass_phrases: false }).catch(Catch.reportErr);
      } else {
        $(`#${id}`).attr('type', 'password');
        Xss.sanitizeRender(target, buttonShow);
        Store.setGlobal({ hide_pass_phrases: true }).catch(Catch.reportErr);
      }
    })).click().click(); // double-click the toggle to prevent browser from prefilling values
  }
};
