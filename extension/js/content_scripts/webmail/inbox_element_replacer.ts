/* © 2016-2018 FlowCrypt Limited. Limitations apply. Contact human@flowcrypt.com */

'use strict';

import { Injector } from '../../common/inject.js';
import { Value, Str } from '../../common/common.js';
import { Api } from '../../common/api.js';
import { Pgp } from '../../common/pgp.js';
import { BrowserMsg } from '../../common/extension.js';
import { Xss, Ui, XssSafeFactory, WebmailVariantString } from '../../common/browser.js';
import { Att } from '../../common/att.js';
import { WebmailElementReplacer } from './setup_webmail_content_script.js';
import { Catch } from '../../common/catch.js';

export class InboxElementReplacer implements WebmailElementReplacer {

  private addresses: string[];
  private factory: XssSafeFactory;
  private acctEmail: string;
  private canReadEmails: boolean;
  private msgTextElSel = 'div.b5.xJNT8d';

  constructor(factory: XssSafeFactory, acctEmail: string, addresses: string[], canReadEmails: boolean, injector: Injector, gmailVariant: WebmailVariantString) {
    this.factory = factory;
    this.acctEmail = acctEmail;
    this.addresses = addresses;
    this.canReadEmails = canReadEmails;
  }

  everything = () => {
    this.replaceArmoredBlocks();
    this.replaceStandardReplyBox();
    this.replaceAtts();
  }

  setReplyBoxEditable = () => {
    throw Error('not implemented');
  }

  reinsertReplyBox = (subject: string, myEmail: string, replyTo: string[], threadId: string) => {
    let params = { subject, replyTo, addresses: this.addresses, myEmail, threadId, threadMessageId: threadId };
    $('.reply_message_iframe_container').append(this.factory.embeddedReply(params, false, true)); // xss-safe-factory
  }

  scrollToBottomOfConvo = () => {
    // not implemented for Google Inbox - which will be deprecated soon
  }

  private replaceArmoredBlocks = () => {
    let self = this;
    $(this.msgTextElSel).not('.evaluated').addClass('evaluated').filter(":contains('" + Pgp.armor.headers('null').begin + "')").each((i, msgEl) => { // for each email that contains PGP block
      let msgId = self.domExtractMsgId(msgEl);
      let senderEmail = self.domExtractSenderEmail(msgEl);
      let isOutgoing = Value.is(senderEmail).in(this.addresses);
      let replacementXssSafe = Ui.replaceRenderableMsgBlocks(self.factory, msgEl.innerText, msgId || '', senderEmail || '', isOutgoing);  // xss-safe-factory
      if (typeof replacementXssSafe !== 'undefined') {
        $(msgEl).parents('.ap').addClass('pgp_message_container');
        $(msgEl).html(replacementXssSafe.replace(/^…|…$/g, '').trim()); // xss-safe-factory
      }
    });
  }

  private replaceStandardReplyBox = (editable = false, forceReplaceEvenIfPgpBlockIsNotPresent = false) => {
    let self = this;
    $('div.f2FE1c').not('.reply_message_iframe_container').filter(':visible').first().each((i, replyBox) => {
      let rootEl = self.domGetConversationRootEl(replyBox);
      if (rootEl.find('iframe.pgp_block').filter(':visible').length || (rootEl.is(':visible') && forceReplaceEvenIfPgpBlockIsNotPresent)) {
        let iframeXssSafe = self.factory.embeddedReply(self.getConvoParams(rootEl), editable);
        $(replyBox).addClass('reply_message_iframe_container').html(iframeXssSafe).children(':not(iframe)').css('display', 'none'); // xss-safe-factory
      }
    });
  }

  private replaceAtts = () => {
    for (let attsContainerEl of $('div.OW').get()) {
      let attsContainer = $(attsContainerEl);
      let newPgpMsgs = attsContainer.children(Att.pgpNamePatterns().map(this.getAttSel).join(',')).not('.evaluated').addClass('evaluated');
      if (newPgpMsgs.length) {
        let msgRootContainer = attsContainer.parents('.ap');
        let msgEl = msgRootContainer.find(this.msgTextElSel);
        let msgId = this.domExtractMsgId(msgEl);
        if (msgId) {
          if (this.canReadEmails) {
            Xss.sanitizePrepend(newPgpMsgs, this.factory.embeddedAttaStatus('Getting file info..' + Ui.spinner('green')));
            Api.gmail.msgGet(this.acctEmail, msgId, 'full').then(msg => {
              this.processAtts(msgId!, msgEl, Api.gmail.findAtts(msg), attsContainer); // msgId checked right above
            }, () => $(newPgpMsgs).find('.attachment_loader').text('Failed to load'));
          } else {
            let statusMsg = 'Missing Gmail permission to decrypt attachments. <a href="#" class="auth_settings">Settings</a></div>';
            $(newPgpMsgs).prepend(this.factory.embeddedAttaStatus(statusMsg)).children('a.auth_settings').click(Ui.event.handle(() => { // xss-safe-factory
              BrowserMsg.send(null, 'settings', { acctEmail: this.acctEmail, page: '/chrome/settings/modules/auth_denied.htm' });
            }));
          }
        } else {
          $(newPgpMsgs).prepend(this.factory.embeddedAttaStatus('Unknown message id')); // xss-safe-factory
        }
      }
    }
  }

  // todo - mostly the same as gmail/replace.ts
  private processAtts = (msgId: string, msgEl: JQuery<HTMLElement>, attMetas: Att[], attsContainer: JQuery<HTMLElement> | HTMLElement, skipGoogleDrive = false) => {
    let senderEmail = this.domExtractSenderEmail(msgEl);
    let isOutgoing = Value.is(senderEmail).in(this.addresses);
    attsContainer = $(attsContainer);
    for (let a of attMetas) {
      let treatAs = a.treatAs();
      if (treatAs !== 'standard') {
        let attSel = (attsContainer as JQuery<HTMLElement>).find(this.getAttSel(a.name)).first();
        this.hideAtt(attSel, attsContainer);
        if (treatAs === 'encrypted') { // actual encrypted attachment - show it
          (attsContainer as JQuery<HTMLElement>).prepend(this.factory.embeddedAtta(a)); // xss-safe-factory
        } else if (treatAs === 'message') {
          msgEl.append(this.factory.embeddedMsg('', msgId, false, senderEmail || '', false)).css('display', 'block'); // xss-safe-factory
        } else if (treatAs === 'publicKey') { // todo - pubkey should be fetched in pgp_pubkey.js
          Api.gmail.attGet(this.acctEmail, msgId, a.id!).then(downloadedAtt => {
            if (Value.is(Pgp.armor.headers('null').begin).in(downloadedAtt.data)) {
              msgEl.append(this.factory.embeddedPubkey(downloadedAtt.data, isOutgoing)); // xss-safe-factory
            } else {
              attSel.css('display', 'block');
              attSel.children('.attachment_loader').text('Unknown Public Key Format');
            }
          }).catch(e => (attsContainer as JQuery<HTMLElement>).find('.attachment_loader').text('Please reload page'));
        } else if (treatAs === 'signature') {
          let embeddedSignedMsgXssSafe = this.factory.embeddedMsg(Str.normalizeSpaces(msgEl[0].innerText).trim(), msgId, false, senderEmail || '', false, true);
          if (!msgEl.is('.evaluated') && !Value.is(Pgp.armor.headers('null').begin).in(msgEl.text())) {
            msgEl.addClass('evaluated');
            msgEl.html(embeddedSignedMsgXssSafe).css('display', 'block'); // xss-safe-factory
          } else {
            msgEl.append(embeddedSignedMsgXssSafe).css('display', 'block'); // xss-safe-factory
          }
        }
      }
    }
    let notProcessedAttsLoaders = attsContainer.find('.attachment_loader');
    if (!skipGoogleDrive && notProcessedAttsLoaders.length && msgEl.find('.gmail_drive_chip, a[href^="https://drive.google.com/file"]').length) {
      // replace google drive attachments - they do not get returned by Gmail API thus did not get replaced above
      let googleDriveAtts: Att[] = [];
      notProcessedAttsLoaders.each((i, loaderEl) => {
        try {
          let meta = $(loaderEl).parent().attr('download_url')!.split(':');
          googleDriveAtts.push(new Att({ msgId, name: meta[1], type: meta[0], url: meta[2] + ':' + meta[3], treatAs: 'encrypted' }));
        } catch (e) {
          Catch.report(e);
        }
      });
      this.processAtts(msgId, msgEl, googleDriveAtts, attsContainer, true);
    }
  }

  private getAttSel = (fileNameFilter: string) => {
    if (fileNameFilter.indexOf('*.') === 0) { // ends with
      return 'div[title*="' + fileNameFilter.substr(1).replace(/@/g, '%40') + '"]';
    } else { // exact name
      return 'div[title="' + fileNameFilter.replace(/@/g, '%40') + '"]';
    }
  }

  private hideAtt = (attEl: JQuery<HTMLElement> | HTMLElement, attsContainerSel: JQuery<HTMLElement> | HTMLElement) => {
    $(attEl).css('display', 'none');
    if (!$(attEl).length) {
      $(attsContainerSel).children('.attachment_loader').text('Missing file info');
    }
  }

  private domGetConversationRootEl = (baseEl: HTMLElement) => {
    return $(baseEl).parents('.top-level-item').first();
  }

  private domExtractSenderEmail = (baseEl: HTMLElement | JQuery<HTMLElement>) => {
    if ($(baseEl).is('.top-level-item')) {
      return $(baseEl).find('.ap').last().find('.fX').attr('email');
    } else {
      return $(baseEl).parents('.ap').find('.fX').attr('email');
    }
  }

  private domExtractRecipients = (baseEl: HTMLElement | JQuery<HTMLElement>) => {
    let m;
    if ($(baseEl).is('.top-level-item')) {
      m = $(baseEl).find('.ap').last();
    } else {
      m = $(baseEl).parents('.ap');
    }
    let recipients: string[] = [];
    m.find('.fX').siblings('span[email]').each((i, recipientEl) => {
      let email = $(recipientEl).attr('email');
      if (email) {
        recipients.push(email);
      }
    });
    return recipients;
  }

  private domExtractMsgId = (baseEl: HTMLElement | JQuery<HTMLElement>) => {
    let inboxMsgIdMatch = ($(baseEl).parents('.ap').attr('data-msg-id') || '').match(/[0-9]{18,20}/g);
    if (inboxMsgIdMatch) {
      return Str.intToHex(inboxMsgIdMatch[0]);
    }
  }

  private domExtractSubject = (convoRootEl: HTMLElement | JQuery<HTMLElement>) => {
    return $(convoRootEl).find('.eo').first().text();
  }

  private domExtractThreadId = (convoRootEl: HTMLElement | JQuery<HTMLElement>) => {
    let inboxThreadIdMatch = ($(convoRootEl).attr('data-item-id') || '').match(/[0-9]{18,20}/g);
    if (inboxThreadIdMatch) {
      return Str.intToHex(inboxThreadIdMatch[0]);
    }
  }

  private getConvoParams = (convoRootEl: HTMLElement | JQuery<HTMLElement>) => {
    let threadId = this.domExtractThreadId(convoRootEl);
    let headers = Api.common.replyCorrespondents(this.acctEmail, this.addresses, this.domExtractSenderEmail(convoRootEl) || '', this.domExtractRecipients(convoRootEl));
    return {
      subject: this.domExtractSubject(convoRootEl),
      reply_to: headers.to,
      addresses: this.addresses,
      my_email: headers.from,
      threadId,
      threadMsgId: threadId ? threadId : this.domExtractMsgId($(convoRootEl).find('.ap').last().children().first()), // backup
    };
  }

}
