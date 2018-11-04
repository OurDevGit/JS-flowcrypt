/* © 2016-2018 FlowCrypt Limited. Limitations apply. Contact human@flowcrypt.com */

'use strict';

import { Store } from '../../js/common/store.js';
import { Catch } from '../../js/common/common.js';
import { Ui } from '../../js/common/browser.js';
import { BrowserMsg } from '../../js/common/extension.js';

Catch.try(async () => {

  let redirectToInitSetup = async (acctEmail:string|null=null) => {
    await BrowserMsg.sendAwait(null, 'settings', { acctEmail });
    window.close();
  };

  let chooseEmailOrSettingsPopup = (activeAcctEmail:string|null=null) => {
    $('#email_or_settings').css('display', 'block');
    $('.action_open_settings').click(Ui.event.handle(async () => {
      if (activeAcctEmail) {
        await redirectToInitSetup(activeAcctEmail);
      } else {
        window.location.href = 'select_account.htm?action=settings';
      }
    }));
    $('.action_open_encrypted_inbox').click(Ui.event.handle(async () => {
      if (activeAcctEmail) {
        await BrowserMsg.sendAwait(null, 'inbox', { acctEmail: activeAcctEmail });
        window.close();
      } else {
        window.location.href = 'select_account.htm?action=inbox';
      }
    }));
  };

  let setupAcctPromptPopup = (activeAcctEmail: string) => {
    $('#set_up_account').css('display', 'block');
    $('.email').text(activeAcctEmail);
    $('.action_set_up_account').click(Ui.event.prevent('double', () => redirectToInitSetup(activeAcctEmail).catch(Catch.rejection)));
  };

  let activeTab = await BrowserMsg.sendAwait(null, 'get_active_tab_info', {});
  if (activeTab && activeTab.acctEmail !== null) {
    let {setup_done} = await Store.getAcct(activeTab.acctEmail, ['setup_done']);
    if (setup_done) {
      chooseEmailOrSettingsPopup(activeTab.acctEmail);
    } else {
      setupAcctPromptPopup(activeTab.acctEmail);
    }
  } else if (activeTab && activeTab.provider !== null && activeTab.sameWorld === true) {
    setupAcctPromptPopup(activeTab.acctEmail);
  } else {
    let accountEmails = await Store.acctEmailsGet();
    if (accountEmails && accountEmails.length) {
      let acctStorages = await Store.getAccounts(accountEmails, ['setup_done']);
      let functioningAccts = 0;
      for (let email of Object.keys(acctStorages)) {
        functioningAccts += Number(acctStorages[email].setup_done === true);
      }
      if (!functioningAccts) {
        await redirectToInitSetup();
      } else {
        chooseEmailOrSettingsPopup();
      }
    } else {
      await redirectToInitSetup();
    }
  }

})();
