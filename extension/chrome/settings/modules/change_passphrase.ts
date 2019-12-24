/* © 2016-2018 FlowCrypt Limited. Limitations apply. Contact human@flowcrypt.com */

'use strict';

import { Assert } from '../../../js/common/assert.js';
import { Catch } from '../../../js/common/platform/catch.js';
import { KeyImportUi } from '../../../js/common/ui/key_import_ui.js';
import { KeyInfo } from '../../../js/common/core/pgp-key.js';
import { PgpKey } from '../../../js/common/core/pgp-key.js';
import { Settings } from '../../../js/common/settings.js';
import { Store } from '../../../js/common/platform/store.js';
import { Ui } from '../../../js/common/browser/ui.js';
import { Url } from '../../../js/common/core/common.js';
import { View } from '../../../js/common/view.js';
import { initPassphraseToggle } from '../../../js/common/ui/passphrase_ui.js';

View.run(class ChangePassPhraseView extends View {

  private readonly acctEmail: string;
  private readonly parentTabId: string;
  private readonly keyImportUi = new KeyImportUi({});

  private primaryKi: KeyInfo | undefined;
  private primaryPrv: OpenPGP.key.Key | undefined;

  constructor() {
    super();
    const uncheckedUrlParams = Url.parse(['acctEmail', 'parentTabId']);
    this.acctEmail = Assert.urlParamRequire.string(uncheckedUrlParams, 'acctEmail');
    this.parentTabId = Assert.urlParamRequire.string(uncheckedUrlParams, 'parentTabId');
  }

  render = async () => {
    await initPassphraseToggle(['current_pass_phrase', 'new_pass_phrase', 'new_pass_phrase_confirm']);
    const privateKeys = await Store.keysGet(this.acctEmail);
    if (privateKeys.length > 1) {
      $('#step_0_enter_current .sentence').text('Enter the current passphrase for your primary key');
      $('#step_0_enter_current #current_pass_phrase').attr('placeholder', 'Current primary key pass phrase');
      $('#step_1_enter_new #new_pass_phrase').attr('placeholder', 'Enter a new primary key pass phrase');
    }
    const [primaryKi] = await Store.keysGet(this.acctEmail, ['primary']);
    this.primaryKi = primaryKi;
    Assert.abortAndRenderErrorIfKeyinfoEmpty(this.primaryKi);
    const storedOrSessionPp = await Store.passphraseGet(this.acctEmail, this.primaryKi.longid);
    const key = await PgpKey.read(this.primaryKi.private);
    this.primaryPrv = key;
    if (this.primaryPrv.isFullyDecrypted() || (storedOrSessionPp && await PgpKey.decrypt(this.primaryPrv, storedOrSessionPp))) {
      this.displayBlock('step_1_enter_new'); // current pp is already known
      $('#new_pass_phrase').focus();
    } else {
      this.displayBlock('step_0_enter_current');
      $('#current_pass_phrase').focus();
    }
    this.keyImportUi.renderPassPhraseStrengthValidationInput($('#new_pass_phrase'), $('.action_set_pass_phrase'));
  }

  setHandlers = () => {
    $('#step_0_enter_current .action_test_current_passphrase').click(this.setHandler(() => this.actionTestCurrentPassPhraseHandler()));
    $('#step_1_enter_new .action_set_pass_phrase').click(this.setHandler(el => this.actionSetPassPhraseHandler(el)));
    $('#step_2_confirm_new .action_use_another').click(this.setHandler(el => this.actionUseAnotherPassPhraseHandler()));
    $('#step_2_confirm_new .action_change').click(this.setHandlerPrevent('double', () => this.actionDoChangePassPhraseHandler()));
    $('#current_pass_phrase').on('keydown', this.setEnterHandlerThatClicks('#step_0_enter_current .action_test_current_passphrase'));
    $('#new_pass_phrase').on('keydown', this.setEnterHandlerThatClicks('#step_1_enter_new .action_set_pass_phrase'));
    $("#new_pass_phrase_confirm").on('keydown', this.setEnterHandlerThatClicks('#step_2_confirm_new .action_change'));
  }

  private actionTestCurrentPassPhraseHandler = async () => {
    const prv = await PgpKey.read(this.primaryKi!.private);
    if (await PgpKey.decrypt(prv, String($('#current_pass_phrase').val())) === true) {
      this.primaryPrv = prv;
      this.displayBlock('step_1_enter_new');
      $('#new_pass_phrase').focus();
    } else {
      await Ui.modal.error('Pass phrase did not match, please try again.');
      $('#current_pass_phrase').val('').focus();
    }
  }

  private actionSetPassPhraseHandler = async (target: HTMLElement) => {
    if ($(target).hasClass('green')) {
      this.displayBlock('step_2_confirm_new');
      $('#new_pass_phrase_confirm').focus();
    } else {
      await Ui.modal.warning('Please select a stronger pass phrase. Combinations of 4 to 5 uncommon words are the best.');
    }
  }

  private actionUseAnotherPassPhraseHandler = () => {
    $('#new_pass_phrase').val('').keyup();
    $('#new_pass_phrase_confirm').val('');
    this.displayBlock('step_1_enter_new');
    $('#new_pass_phrase').focus();
  }

  private actionDoChangePassPhraseHandler = async () => {
    const newPp = String($('#new_pass_phrase').val());
    if (newPp !== $('#new_pass_phrase_confirm').val()) {
      await Ui.modal.warning('The two pass phrases do not match, please try again.');
      $('#new_pass_phrase_confirm').val('');
      $('#new_pass_phrase_confirm').focus();
      return;
    }
    try {
      await PgpKey.encrypt(this.primaryPrv!, newPp);
    } catch (e) {
      Catch.reportErr(e);
      await Ui.modal.error(`There was an unexpected error. Please ask for help at human@flowcrypt.com:\n\n${e instanceof Error ? e.stack : String(e)}`);
      return;
    }
    await Store.keysAdd(this.acctEmail, this.primaryPrv!.armor());
    const persistentlyStoredPp = await Store.passphraseGet(this.acctEmail, this.primaryKi!.longid, true);
    await Store.passphraseSave('local', this.acctEmail, this.primaryKi!.longid, typeof persistentlyStoredPp === 'undefined' ? undefined : newPp);
    await Store.passphraseSave('session', this.acctEmail, this.primaryKi!.longid, typeof persistentlyStoredPp === 'undefined' ? newPp : undefined);
    const { setup_simple } = await Store.getAcct(this.acctEmail, ['setup_simple']);
    if (setup_simple) {
      Settings.redirectSubPage(this.acctEmail, this.parentTabId, '/chrome/settings/modules/backup.htm', '&action=passphrase_change_gmail_backup');
    } else {
      await Ui.modal.info('Now that you changed your pass phrase, you should back up your key. New backup will be protected with new passphrase.');
      Settings.redirectSubPage(this.acctEmail, this.parentTabId, '/chrome/settings/modules/backup.htm', '&action=options');
    }
  }

  private displayBlock = (name: string) => {
    const blocks = ['step_0_enter_current', 'step_1_enter_new', 'step_2_confirm_new', 'step_3_done'];
    for (const block of blocks) {
      $(`#${block}`).css('display', 'none');
    }
    $(`#${name}`).css('display', 'block');
  }

});
