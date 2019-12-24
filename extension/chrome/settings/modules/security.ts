/* © 2016-2018 FlowCrypt Limited. Limitations apply. Contact human@flowcrypt.com */

'use strict';

import { Backend, FcUuidAuth } from '../../../js/common/api/backend.js';

import { ApiErr } from '../../../js/common/api/error/api-error.js';
import { Assert } from '../../../js/common/assert.js';
import { Catch } from '../../../js/common/platform/catch.js';
import { KeyInfo } from '../../../js/common/core/pgp-key.js';
import { Settings } from '../../../js/common/settings.js';
import { Store } from '../../../js/common/platform/store.js';
import { Ui } from '../../../js/common/browser/ui.js';
import { Url } from '../../../js/common/core/common.js';
import { View } from '../../../js/common/view.js';
import { Xss } from '../../../js/common/platform/xss.js';
import { initPassphraseToggle } from '../../../js/common/ui/passphrase_ui.js';

View.run(class SecurityView extends View {

  private readonly acctEmail: string;
  private readonly parentTabId: string;
  private primaryKi: KeyInfo | undefined;
  private authInfo: FcUuidAuth | undefined;

  constructor() {
    super();
    const uncheckedUrlParams = Url.parse(['acctEmail', 'parentTabId']);
    this.acctEmail = Assert.urlParamRequire.string(uncheckedUrlParams, 'acctEmail');
    this.parentTabId = Assert.urlParamRequire.string(uncheckedUrlParams, 'parentTabId');
  }

  render = async () => {
    await initPassphraseToggle(['passphrase_entry']);
    [this.primaryKi] = await Store.keysGet(this.acctEmail, ['primary']);
    Assert.abortAndRenderErrorIfKeyinfoEmpty(this.primaryKi);
    this.authInfo = await Store.authInfo(this.acctEmail);
    const storage = await Store.getAcct(this.acctEmail, ['hide_message_password', 'outgoing_language']);
    $('#hide_message_password').prop('checked', storage.hide_message_password === true);
    $('.password_message_language').val(storage.outgoing_language || 'EN');
    await this.renderPassPhraseOptionsIfStoredPermanently();
    await this.loadAndRenderPwdEncryptedMsgSettings();
  }

  setHandlers = () => {
    $('.action_change_passphrase').click(this.setHandler(() => Settings.redirectSubPage(this.acctEmail, this.parentTabId, '/chrome/settings/modules/change_passphrase.htm')));
    $('.action_test_passphrase').click(this.setHandler(() => Settings.redirectSubPage(this.acctEmail, this.parentTabId, '/chrome/settings/modules/test_passphrase.htm')));
    $('#hide_message_password').change(this.setHandler((el) => this.hideMsgPasswordHandler(el)));
    $('.password_message_language').change(this.setHandler(() => this.onMsgLanguageUserChange()));
  }

  private renderPassPhraseOptionsIfStoredPermanently = async () => {
    const keys = await Store.keysGet(this.acctEmail);
    if (await this.isAnyPassPhraseStoredPermanently(keys)) {
      $('.forget_passphrase').css('display', '');
      $('.action_forget_pp').click(this.setHandler(() => {
        $('.forget_passphrase').css('display', 'none');
        $('.passphrase_entry_container').css('display', '');
      }));
      $('.confirm_passphrase_requirement_change').click(this.setHandler(async () => {
        const primaryKiPP = await Store.passphraseGet(this.acctEmail, this.primaryKi!.longid);
        if ($('input#passphrase_entry').val() === primaryKiPP) {
          for (const key of keys) {
            await Store.passphraseSave('local', this.acctEmail, key.longid, undefined);
            await Store.passphraseSave('session', this.acctEmail, key.longid, undefined);
          }
          window.location.reload();
        } else {
          await Ui.modal.warning('Pass phrase did not match, please try again.');
          $('input#passphrase_entry').val('').focus();
        }
      }));
      $('.cancel_passphrase_requirement_change').click(() => window.location.reload());
      $('#passphrase_entry').keydown(this.setEnterHandlerThatClicks('.confirm_passphrase_requirement_change'));
    }
  }

  private loadAndRenderPwdEncryptedMsgSettings = async () => {
    const subscription = await Store.subscription(this.acctEmail);
    if (subscription.active) {
      Xss.sanitizeRender('.select_loader_container', Ui.spinner('green'));
      try {
        const response = await Backend.accountGetAndUpdateLocalStore(this.authInfo!);
        $('.select_loader_container').text('');
        $('.default_message_expire').val(Number(response.account.default_message_expire).toString()).prop('disabled', false).css('display', 'inline-block');
        $('.default_message_expire').change(this.setHandler(() => this.onDefaultExpireUserChange()));
      } catch (e) {
        if (ApiErr.isAuthErr(e)) {
          Settings.offerToLoginWithPopupShowModalOnErr(this.acctEmail, () => window.location.reload());
        } else if (ApiErr.isNetErr(e)) {
          Xss.sanitizeRender('.expiration_container', '(network error: <a href="#">retry</a>)').find('a').click(() => window.location.reload()); // safe source
        } else {
          Catch.reportErr(e);
          Xss.sanitizeRender('.expiration_container', '(unknown error: <a href="#">retry</a>)').find('a').click(() => window.location.reload()); // safe source
        }
      }
    } else {
      $('.default_message_expire').val('3').css('display', 'inline-block');
      Xss.sanitizeAppend($('.default_message_expire').parent(), '<a href="#">upgrade</a>')
        .find('a').click(this.setHandler(() => Settings.redirectSubPage(this.acctEmail, this.parentTabId, '/chrome/elements/subscribe.htm')));
    }
  }

  private onDefaultExpireUserChange = async () => {
    Xss.sanitizeRender('.select_loader_container', Ui.spinner('green'));
    $('.default_message_expire').css('display', 'none');
    await Backend.accountUpdate(this.authInfo!, { default_message_expire: Number($('.default_message_expire').val()) });
    window.location.reload();
  }

  private onMsgLanguageUserChange = async () => {
    const outgoingLanguage = String($('.password_message_language').val());
    if (['EN', 'DE'].includes(outgoingLanguage)) {
      await Store.setAcct(this.acctEmail, { outgoing_language: outgoingLanguage as 'DE' | 'EN' });
      window.location.reload();
    }
  }

  private hideMsgPasswordHandler = async (checkbox: HTMLElement) => {
    await Store.setAcct(this.acctEmail, { hide_message_password: $(checkbox).is(':checked') });
    window.location.reload();
  }

  private isAnyPassPhraseStoredPermanently = async (keys: KeyInfo[]) => {
    for (const key of keys) {
      if (await Store.passphraseGet(this.acctEmail, key.longid, true)) {
        return true;
      }
    }
    return false;
  }
});
