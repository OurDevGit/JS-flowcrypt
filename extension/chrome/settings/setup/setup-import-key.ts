/* ©️ 2016 - present FlowCrypt a.s. Limitations apply. Contact human@flowcrypt.com */

'use strict';

import { KeyCanBeFixed, UserAlert } from '../../../js/common/ui/key-import-ui.js';
import { SetupOptions, SetupView } from '../setup.js';

import { Catch } from '../../../js/common/platform/catch.js';
import { Settings } from '../../../js/common/settings.js';
import { Ui } from '../../../js/common/browser/ui.js';
import { Xss } from '../../../js/common/platform/xss.js';
import { Key, UnexpectedKeyTypeError } from '../../../js/common/core/crypto/key.js';
import { Lang } from '../../../js/common/lang.js';
import { saveKeysAndPassPhrase } from '../../../js/common/helpers.js';

export class SetupImportKeyModule {
  // eslint-disable-next-line no-empty-function
  public constructor(private view: SetupView) {}

  public actionImportPrivateKeyHandle = async (button: HTMLElement) => {
    if (button.className.includes('gray')) {
      await Ui.modal.warning('Please double check the pass phrase input field for any issues.');
      return;
    }
    /* eslint-disable @typescript-eslint/naming-convention */
    const options: SetupOptions = {
      passphrase: String($('#step_2b_manual_enter .input_passphrase').val()),
      submit_main: this.view.shouldSubmitPubkey('#step_2b_manual_enter .input_submit_key'),
      submit_all: this.view.shouldSubmitPubkey('#step_2b_manual_enter .input_submit_all'),
      passphrase_save: Boolean($('#step_2b_manual_enter .input_passphrase_save').prop('checked')),
      recovered: false,
    };
    /* eslint-enable @typescript-eslint/naming-convention */
    try {
      const checked = await this.view.keyImportUi.checkPrv(
        this.view.acctEmail,
        String($('#step_2b_manual_enter .input_private_key').val()),
        options.passphrase
      );
      if (checked.decrypted.family === 'x509') {
        if (
          !(await Ui.modal.confirm(
            'Using S/MIME as the only key on account is experimental. ' +
              'You should instead import an OpenPGP key here, and then add S/MIME keys as additional keys in FlowCrypt Settings.' +
              '\n\nContinue anyway? (not recommented).'
          ))
        ) {
          return;
        }
      }
      Xss.sanitizeRender('#step_2b_manual_enter .action_add_private_key', Ui.spinner('white'));
      await saveKeysAndPassPhrase(this.view.acctEmail, [checked.encrypted], options);
      await this.view.submitPublicKeys(options);
      await this.view.finalizeSetup();
      await this.view.setupRender.renderSetupDone();
    } catch (e) {
      if (e instanceof UserAlert) {
        return await Ui.modal.warning(e.message, Ui.testCompatibilityLink);
      } else if (e instanceof KeyCanBeFixed) {
        return await this.renderCompatibilityFixBlockAndFinalizeSetup(e.encrypted, options);
      } else if (e instanceof UnexpectedKeyTypeError) {
        return await Ui.modal.warning(`This does not appear to be a validly formatted key.\n\n${e.message}`);
      } else {
        Catch.reportErr(e);
        return await Ui.modal.error(
          `An error happened when processing the key: ${String(e)}\n${Lang.general.contactForSupportSentence(this.view.isFesUsed())}`,
          false,
          Ui.testCompatibilityLink
        );
      }
    }
  };

  public renderCompatibilityFixBlockAndFinalizeSetup = async (origPrv: Key, options: SetupOptions) => {
    $('.ask_support_assistance_container').text(Lang.general.contactIfNeedAssistance(this.view.isFesUsed()));
    this.view.setupRender.displayBlock('step_3_compatibility_fix');
    let fixedPrv;
    try {
      fixedPrv = await Settings.renderPrvCompatFixUiAndWaitTilSubmittedByUser(
        this.view.acctEmail,
        '#step_3_compatibility_fix',
        origPrv,
        options.passphrase,
        window.location.href.replace(/#$/, '')
      );
    } catch (e) {
      Catch.reportErr(e);
      await Ui.modal.error(`Failed to fix key (${String(e)}). ${Lang.general.writeMeToFixIt(this.view.isFesUsed())}`, false, Ui.testCompatibilityLink);
      this.view.setupRender.displayBlock('step_2b_manual_enter');
      return;
    }
    await saveKeysAndPassPhrase(this.view.acctEmail, [fixedPrv], options);
    await this.view.submitPublicKeys(options);
    await this.view.finalizeSetup();
    await this.view.setupRender.renderSetupDone();
  };
}
