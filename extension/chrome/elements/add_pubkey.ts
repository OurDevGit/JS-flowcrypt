/* © 2016-2018 FlowCrypt Limited. Limitations apply. Contact human@flowcrypt.com */

'use strict';

import { Catch } from '../../js/common/platform/catch.js';
import { Store } from '../../js/common/platform/store.js';
import { Xss, Ui, Env } from '../../js/common/browser.js';
import { BrowserMsg } from '../../js/common/extension.js';
import { Assert } from '../../js/common/assert.js';
import { KeyImportUi, processPublicKeyFileImport, UserAlert, } from '../../js/common/ui/key_import_ui.js';
import { AttUI } from '../../js/common/ui/att_ui.js';

Catch.try(async () => {

  Ui.event.protect();

  const uncheckedUrlParams = Env.urlParams(['acctEmail', 'parentTabId', 'emails', 'placement']);
  const acctEmail = Assert.urlParamRequire.string(uncheckedUrlParams, 'acctEmail');
  const parentTabId = Assert.urlParamRequire.string(uncheckedUrlParams, 'parentTabId');
  const missingPubkeyEmails = Assert.urlParamRequire.string(uncheckedUrlParams, 'emails').split(',');
  const placement = Assert.urlParamRequire.optionalString(uncheckedUrlParams, 'placement');

  for (const missingPubkeyEmail of missingPubkeyEmails) {
    Xss.sanitizeAppend('select.email', `<option value="${Xss.escape(missingPubkeyEmail)}">${Xss.escape(missingPubkeyEmail)}</option>`);
  }
  for (const contact of await Store.dbContactSearch(undefined, { has_pgp: true })) {
    Xss.sanitizeAppend('select.copy_from_email', `<option value="${Xss.escape(contact.email)}">${Xss.escape(contact.email)}</option>`);
  }

  const closeDialog = () => BrowserMsg.send.closeDialog(parentTabId);

  $('select.copy_from_email').change(Ui.event.handle(async target => {
    if ($(target).val()) {
      const [contact] = await Store.dbContactGet(undefined, [String($(target).val())]);
      if (contact && contact.pubkey) {
        $('.pubkey').val(contact.pubkey).prop('disabled', true);
      } else {
        Catch.report('Contact unexpectedly not found when copying pubkey by email in add_pubkey.htm');
        await Ui.modal.error('Contact not found.');
      }
    } else {
      $('.pubkey').val('').prop('disabled', false);
    }
  }));

  $('.action_ok').click(Ui.event.handle(async () => {
    try {
      const keyImportUi = new KeyImportUi({ checkEncryption: true });
      const normalized = await keyImportUi.checkPub(String($('.pubkey').val()));
      await Store.dbContactSave(undefined, await Store.dbContactObj(String($('select.email').val()), undefined, 'pgp', normalized, false, Date.now()));
      closeDialog();
    } catch (e) {
      if (e instanceof UserAlert) {
        await Ui.modal.warning(e.message);
      } else {
        Catch.reportErr(e);
        await Ui.modal.error(`Error happened when processing the public key: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }));

  if (placement !== 'settings') {
    $('.action_settings').click(Ui.event.handle(() => BrowserMsg.send.bg.settings({ path: 'index.htm', page: '/chrome/settings/modules/contacts.htm', acctEmail })));
  } else {
    $('#content').addClass('inside_compose');
  }

  $('.action_close').click(Ui.event.handle(closeDialog));

  const attUI = new AttUI(() => Promise.resolve({ size_mb: 5, size: 5 * 1024 * 1024, count: 1 }));
  attUI.initAttDialog('fineuploader', 'fineuploader_button');
  attUI.setAttAddedCb(async (file) => {
    const keys = await processPublicKeyFileImport(attUI, file);
    if (keys && keys.length) {
      $('.pubkey').val(String(keys[0].armor()));
      $('.action_ok').trigger('click');
    }
  });

})();
