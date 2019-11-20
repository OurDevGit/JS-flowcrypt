/* © 2016-2018 FlowCrypt Limited. Limitations apply. Contact human@flowcrypcom */

'use strict';

import { ComposerComponent } from './interfaces/composer-component.js';
import { SendBtnTexts } from './interfaces/composer-types.js';
import { Composer } from './composer.js';
import { Xss } from '../platform/xss.js';
import { Ui } from '../browser.js';
import { Catch } from '../platform/catch.js';
import { Api } from '../api/api.js';
import { BrowserMsg } from '../extension.js';
import { Pgp, KeyInfo } from '../core/pgp.js';
import { Store } from '../platform/store.js';
import { GmailRes } from '../api/google.js';
import { SendableMsg } from '../api/email_provider_api.js';
import { Att } from '../core/att.js';
import { GeneralMailFormatter } from './formatters/composer-mail-formatter.js';
import { ComposerSendBtnPopover } from './composer-send-btn-popover.js';

export class ComposerSendBtn extends ComposerComponent {

  public additionalMsgHeaders: { [key: string]: string } = {};

  public btnUpdateTimeout?: number;

  private isSendMessageInProgress = false;

  public popover: ComposerSendBtnPopover;

  constructor(composer: Composer) {
    super(composer);
    this.popover = new ComposerSendBtnPopover(composer);
  }

  initActions(): void {
    this.composer.S.cached('body').keypress(Ui.ctrlEnter(() => !this.composer.size.isMinimized() && this.extractProcessSendMsg()));
    this.composer.S.cached('send_btn').click(Ui.event.prevent('double', () => this.extractProcessSendMsg()));
    this.popover.initActions();
  }

  isSendMessageInProgres(): boolean {
    return this.isSendMessageInProgress;
  }

  resetSendBtn(delay?: number) {
    const doReset = () => {
      Xss.sanitizeRender(this.composer.S.cached('send_btn_text'), `<i></i>${this.btnText()}`);
      this.composer.S.cached('toggle_send_options').show();
    };
    if (typeof this.btnUpdateTimeout !== 'undefined') {
      clearTimeout(this.btnUpdateTimeout);
    }
    if (!delay) {
      doReset();
    } else {
      Catch.setHandledTimeout(doReset, delay);
    }
  }

  setBtnColor(color: 'green' | 'gray') {
    const classToAdd = color;
    const classToRemove = ['green', 'gray'].find(c => c !== color);
    this.composer.S.cached('send_btn').removeClass(classToRemove).addClass(classToAdd);
    this.composer.S.cached('toggle_send_options').removeClass(classToRemove).addClass(classToAdd);
  }

  private btnText(): string {
    if (this.popover.choices.encrypt && this.popover.choices.sign) {
      return SendBtnTexts.BTN_ENCRYPT_SIGN_AND_SEND;
    } else if (this.popover.choices.encrypt) {
      return SendBtnTexts.BTN_ENCRYPT_AND_SEND;
    } else if (this.popover.choices.sign) {
      return SendBtnTexts.BTN_SIGN_AND_SEND;
    } else {
      return SendBtnTexts.BTN_PLAIN_SEND;
    }
  }

  private extractProcessSendMsg = async () => {
    this.composer.S.cached('toggle_send_options').hide();
    try {
      this.composer.errs.throwIfFormNotReady();
      this.composer.S.now('send_btn_text').text('Loading');
      Xss.sanitizeRender(this.composer.S.now('send_btn_i'), Ui.spinner('white'));
      this.composer.S.cached('send_btn_note').text('');
      const newMsgData = this.composer.input.extractAll();
      await this.composer.errs.throwIfFormValsInvalid(newMsgData);
      const senderKi = await this.composer.app.storageGetKey(this.urlParams.acctEmail, this.composer.sender.getSender());
      let signingPrv: OpenPGP.key.Key | undefined;
      if (this.popover.choices.sign) {
        signingPrv = await this.decryptSenderKey(senderKi);
        if (!signingPrv) {
          return; // user has canceled the pass phrase dialog, or didn't respond to it in time
        }
      }
      const msgObj = await GeneralMailFormatter.processNewMsg(this.composer, newMsgData, senderKi, signingPrv);
      await this.finalizeSendableMsg(msgObj, senderKi);
      await this.doSendMsg(msgObj);
    } catch (e) {
      await this.composer.errs.handleSendErr(e);
    } finally {
      this.composer.S.cached('toggle_send_options').show();
    }
  }

  private async finalizeSendableMsg(msg: SendableMsg, senderKi: KeyInfo) {
    const choices = this.composer.sendBtn.popover.choices;
    for (const k of Object.keys(this.additionalMsgHeaders)) {
      msg.headers[k] = this.additionalMsgHeaders[k];
    }
    if (choices.encrypt && !choices.richText) {
      for (const a of msg.atts) {
        a.type = 'application/octet-stream'; // so that Enigmail+Thunderbird does not attempt to display without decrypting
      }
    }
    if (this.composer.S.cached('icon_pubkey').is('.active')) {
      msg.atts.push(Att.keyinfoAsPubkeyAtt(senderKi));
    }
    await this.addNamesToMsg(msg);
  }

  private doSendMsg = async (msg: SendableMsg) => {
    let msgSentRes: GmailRes.GmailMsgSend;
    try {
      this.isSendMessageInProgress = true;
      msgSentRes = await this.composer.app.emailProviderMsgSend(msg, this.renderUploadProgress);
    } catch (e) {
      if (msg.thread && Api.err.isNotFound(e) && this.urlParams.threadId) { // cannot send msg because threadId not found - eg user since deleted it
        msg.thread = undefined;
        msgSentRes = await this.composer.app.emailProviderMsgSend(msg, this.renderUploadProgress);
      } else {
        this.isSendMessageInProgress = false;
        throw e;
      }
    }
    BrowserMsg.send.notificationShow(this.urlParams.parentTabId, { notification: `Your ${this.urlParams.isReplyBox ? 'reply' : 'message'} has been sent.` });
    BrowserMsg.send.focusBody(this.urlParams.parentTabId); // Bring focus back to body so Gmails shortcuts will work
    await this.composer.draft.draftDelete();
    this.isSendMessageInProgress = false;
    if (this.urlParams.isReplyBox) {
      this.renderReplySuccess(msg, msgSentRes.id);
    } else {
      this.composer.app.closeMsg();
    }
  }

  private decryptSenderKey = async (senderKi: KeyInfo): Promise<OpenPGP.key.Key | undefined> => {
    const prv = await Pgp.key.read(senderKi.private);
    const passphrase = await this.composer.app.storagePassphraseGet(senderKi);
    if (typeof passphrase === 'undefined' && !prv.isFullyDecrypted()) {
      BrowserMsg.send.passphraseDialog(this.urlParams.parentTabId, { type: 'sign', longids: [senderKi.longid] });
      if ((typeof await this.composer.app.whenMasterPassphraseEntered(60)) !== 'undefined') { // pass phrase entered
        return await this.decryptSenderKey(senderKi);
      } else { // timeout - reset - no passphrase entered
        this.resetSendBtn();
        return undefined;
      }
    } else {
      if (!prv.isFullyDecrypted()) {
        await Pgp.key.decrypt(prv, passphrase!); // checked !== undefined above
      }
      return prv;
    }
  }

  public renderUploadProgress = (progress: number) => {
    if (this.composer.atts.attach.hasAtt()) {
      progress = Math.floor(progress);
      this.composer.S.now('send_btn_text').text(`${SendBtnTexts.BTN_SENDING} ${progress < 100 ? `${progress}%` : ''}`);
    }
  }

  private addNamesToMsg = async (msg: SendableMsg): Promise<void> => {
    const { sendAs } = await Store.getAcct(this.urlParams.acctEmail, ['sendAs']);
    const addNameToEmail = async (emails: string[]): Promise<string[]> => {
      return await Promise.all(emails.map(async email => {
        let name: string | undefined;
        if (sendAs && sendAs[email] && sendAs[email].name) {
          name = sendAs[email].name!;
        } else {
          const [contact] = await this.composer.app.storageContactGet([email]);
          if (contact && contact.name) {
            name = contact.name;
          }
        }
        return name ? `${name.replace(/[<>,'"/\\\n\r\t]/g, '')} <${email}>` : email;
      }));
    };
    msg.recipients.to = await addNameToEmail(msg.recipients.to || []);
    msg.recipients.cc = await addNameToEmail(msg.recipients.cc || []);
    msg.recipients.bcc = await addNameToEmail(msg.recipients.bcc || []);
    msg.from = (await addNameToEmail([msg.from]))[0];
  }

  private renderReplySuccess = (msg: SendableMsg, msgId: string) => {
    this.composer.app.renderReinsertReplyBox(msgId);
    if (!this.popover.choices.encrypt) {
      this.composer.S.cached('replied_body').addClass('pgp_neutral').removeClass('pgp_secure');
    }
    this.composer.S.cached('replied_body').css('width', ($('table#compose').width() || 500) - 30);
    this.composer.S.cached('compose_table').css('display', 'none');
    this.composer.S.cached('reply_msg_successful').find('div.replied_from').text(this.composer.sender.getSender());
    this.composer.S.cached('reply_msg_successful').find('div.replied_to span').text(msg.headers.To.replace(/,/g, ', '));
    const repliedBodyEl = this.composer.S.cached('reply_msg_successful').find('div.replied_body');
    Xss.sanitizeRender(repliedBodyEl, Xss.escapeTextAsRenderableHtml(this.composer.input.extract('text', 'input_text', 'SKIP-ADDONS')));
    const t = new Date();
    const time = ((t.getHours() !== 12) ?
      (t.getHours() % 12) : 12) + ':' + (t.getMinutes() < 10 ? '0' : '') + t.getMinutes() + ((t.getHours() >= 12) ? ' PM ' : ' AM ') + '(0 minutes ago)';
    this.composer.S.cached('reply_msg_successful').find('div.replied_time').text(time);
    this.composer.S.cached('reply_msg_successful').css('display', 'block');
    if (msg.atts.length) {
      this.composer.S.cached('replied_attachments').html(msg.atts.map(a => { // xss-safe-factory
        a.msgId = msgId;
        return this.composer.app.factoryAtt(a, true);
      }).join('')).css('display', 'block');
    }
    this.composer.size.resizeComposeBox();
  }

}
