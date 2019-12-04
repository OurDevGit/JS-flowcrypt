/* © 2016-2018 FlowCrypt Limited. Limitations apply. Contact human@flowcrypt.com */

'use strict';

import { Catch } from '../../../js/common/platform/catch.js';
import { Store } from '../../../js/common/platform/store.js';
import { Value, Url } from '../../../js/common/core/common.js';
import { Ui } from '../../../js/common/browser.js';
import { Pgp } from '../../../js/common/core/pgp.js';
import { Api } from '../../../js/common/api/api.js';
import { BrowserMsg } from '../../../js/common/extension.js';
import { Google } from '../../../js/common/api/google.js';
import { Assert } from '../../../js/common/assert.js';
import { KeyImportUi, UserAlert, KeyCanBeFixed } from '../../../js/common/ui/key_import_ui.js';
import { initPassphraseToggle } from '../../../js/common/ui/passphrase_ui.js';
import { Xss } from '../../../js/common/platform/xss.js';
import { View } from '../../../js/common/view.js';

View.run(class AddKeyView extends View {

  private readonly acctEmail: string;
  private readonly parentTabId: string;
  private readonly keyImportUi = new KeyImportUi({ rejectKnown: true });

  constructor() {
    super();
    const uncheckedUrlParams = Url.parse(['acctEmail', 'parentTabId']);
    this.acctEmail = Assert.urlParamRequire.string(uncheckedUrlParams, 'acctEmail');
    this.parentTabId = Assert.urlParamRequire.string(uncheckedUrlParams, 'parentTabId');
  }

  async render() {
    await initPassphraseToggle(['input_passphrase']);
    this.keyImportUi.initPrvImportSrcForm(this.acctEmail, this.parentTabId);
    Xss.sanitizeRender('#spinner_container', Ui.spinner('green') + ' loading..');
    await this.loadAndRenderKeyBackupsOrRenderError();
    $('.source_selector').css('display', 'block');
    $('#spinner_container').text('');
  }

  setHandlers() {
    $('.action_add_private_key').click(this.setHandlerPrevent('double', this.addPrivateKeyHandler));
    $('#input_passphrase').keydown(this.setHandler((el, ev) => {
      if (ev.which === 13) {
        $('.action_add_private_key').click();
      }
    }));
  }

  private async loadAndRenderKeyBackupsOrRenderError() {
    const keyInfos = await Store.keysGet(this.acctEmail);
    const privateKeysLongIds = keyInfos.map(ki => ki.longid);
    let keyBackups: OpenPGP.key.Key[] | undefined;
    try {
      keyBackups = await Google.gmail.fetchKeyBackups(this.acctEmail);
      if (keyBackups.length) {
        const notImportedBackupLongids: string[] = [];
        for (const longid of Value.arr.unique(await Promise.all(keyBackups.map(Pgp.key.longid)))) {
          if (longid && !privateKeysLongIds.includes(longid)) {
            notImportedBackupLongids.push(longid);
          }
        }
        if (notImportedBackupLongids.length) {
          $('label[for=source_backup]').text('Load from backup (' + notImportedBackupLongids.length + ' new to import)');
        } else {
          $('label[for=source_backup]').text('Load from backup (already loaded)').css('color', '#AAA');
          $('#source_backup').prop('disabled', true);
        }
      } else {
        $('label[for=source_backup]').text('Load from backup (no backups found)').css('color', '#AAA');
        $('#source_backup').prop('disabled', true);
      }
    } catch (e) {
      if (Api.err.isAuthPopupNeeded(e)) {
        BrowserMsg.send.notificationShowAuthPopupNeeded(this.parentTabId, { acctEmail: this.acctEmail });
      }
      $('label[for=source_backup]').text('Load from backup (error checking backups)').css('color', '#AAA');
      $('#source_backup').prop('disabled', true);
    }
  }

  private async addPrivateKeyHandler(submitBtn: HTMLElement) {
    if (submitBtn.className.includes('gray')) {
      await Ui.modal.warning('Please double check the pass phrase input field for any issues.');
      return;
    }
    try {
      const checked = await this.keyImportUi.checkPrv(this.acctEmail, String($('.input_private_key').val()), String($('.input_passphrase').val()));
      if (checked) {
        await Store.keysAdd(this.acctEmail, checked.normalized); // resulting new_key checked above
        await Store.passphraseSave($('.input_passphrase_save').prop('checked') ? 'local' : 'session', this.acctEmail,
          checked.longid, checked.passphrase);
        BrowserMsg.send.reload(this.parentTabId, { advanced: true });
      }
    } catch (e) {
      if (e instanceof UserAlert) {
        return await Ui.modal.warning(e.message);
      } else if (e instanceof KeyCanBeFixed) {
        return await Ui.modal.error(`This type of key cannot be set as non-primary yet. Please write human@flowcrypt.com`);
      } else {
        Catch.reportErr(e);
        return await Ui.modal.error(`An error happened when processing the key: ${String(e)}\nPlease write at human@flowcrypt.com`);
      }
    }
  }
});
