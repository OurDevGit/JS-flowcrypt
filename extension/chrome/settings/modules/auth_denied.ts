/* © 2016-2018 FlowCrypt Limited. Limitations apply. Contact human@flowcrypt.com */

'use strict';

import { Store } from '../../../js/common/store.js';
import { Ui, Env } from '../../../js/common/browser.js';
import { BrowserMsg } from '../../../js/common/extension.js';
import { Catch } from '../../../js/common/catch.js';

Catch.try(async () => {

  const urlParams = Env.urlParams(['acctEmail', 'parentTabId', 'emailProvider']);
  const acctEmail = urlParams.acctEmail as string | undefined;
  const parentTabId = Env.urlParamRequire.string(urlParams, 'parentTabId');
  if (!urlParams.emailProvider) {
    urlParams.emailProvider = 'gmail';
  }

  const renderSetupDone = (setupDone: boolean) => {
    if (setupDone) {
      $('.show_if_setup_done').css('display', 'block');
    } else {
      $('.show_if_setup_not_done').css('display', 'block');
    }
  };

  if (!urlParams.acctEmail) {
    renderSetupDone(false);
  } else {
    const { setup_done } = await Store.getAcct(acctEmail!, ['setup_done']);
    renderSetupDone(setup_done || false);
  }

  $('.hidable').not('.' + urlParams.emailProvider).css('display', 'none');

  if (urlParams.emailProvider === 'outlook') {
    $('.permission_send').text('Manage drafts and send emails');
    $('.permission_read').text('Read messages');
  } else { // gmail
    $('.permission_send').text('Manage drafts and send emails');
    $('.permission_read').text('Read messages');
  }

  $('.action_auth_proceed').click(Ui.event.handle(() => BrowserMsg.send.openGoogleAuthDialog(parentTabId, { acctEmail })));

  $('.auth_action_limited').click(Ui.event.handle(() => BrowserMsg.send.openGoogleAuthDialog(parentTabId, { omitReadScope: true, acctEmail })));

  $('.close_page').click(Ui.event.handle(() => BrowserMsg.send.closePage(parentTabId)));

})();
