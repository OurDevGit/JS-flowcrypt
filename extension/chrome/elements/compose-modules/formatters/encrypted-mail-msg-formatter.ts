/* ©️ 2016 - present FlowCrypt a.s. Limitations apply. Contact human@flowcrypt.com */

'use strict';

import { BaseMailFormatter } from './base-mail-formatter.js';
import { ComposerResetBtnTrigger } from '../compose-err-module.js';
import { Mime, SendableMsgBody } from '../../../../js/common/core/mime.js';
import { getUniqueRecipientEmails, NewMsgData } from '../compose-types.js';
import { EmailParts, Str, Value } from '../../../../js/common/core/common.js';
import { ApiErr } from '../../../../js/common/api/shared/api-error.js';
import { Attachment } from '../../../../js/common/core/attachment.js';
import { Buf } from '../../../../js/common/core/buf.js';
import { Catch } from '../../../../js/common/platform/catch.js';
import { Lang } from '../../../../js/common/lang.js';
import { PubkeyResult, Key, KeyUtil } from '../../../../js/common/core/crypto/key.js';
import { MsgUtil, PgpMsgMethod } from '../../../../js/common/core/crypto/pgp/msg-util.js';
import { SendableMsg } from '../../../../js/common/api/email-provider/sendable-msg.js';
import { Settings } from '../../../../js/common/settings.js';
import { Ui } from '../../../../js/common/browser/ui.js';
import { Xss } from '../../../../js/common/platform/xss.js';
import { AcctStore } from '../../../../js/common/platform/store/acct-store.js';
import { FcUuidAuth } from '../../../../js/common/api/account-servers/flowcrypt-com-api.js';
import { SmimeKey } from '../../../../js/common/core/crypto/smime/smime-key.js';
import { PgpHash } from '../../../../js/common/core/crypto/pgp/pgp-hash.js';
import { UploadedMessageData } from '../../../../js/common/api/account-server.js';
import { ParsedKeyInfo } from '../../../../js/common/core/crypto/key-store-util.js';
import { MultipleMessages } from './general-mail-formatter.js';
import { Api, RecipientType } from '../../../../js/common/api/shared/api.js';

export class EncryptedMsgMailFormatter extends BaseMailFormatter {

  public sendableMsgs = async (newMsg: NewMsgData, pubkeys: PubkeyResult[], signingKey?: ParsedKeyInfo): Promise<MultipleMessages> => {
    if (newMsg.pwd && !this.isDraft) {
      return await this.formatSendablePwdMsgs(newMsg, pubkeys, signingKey);
    } else {
      const msg = await this.sendableNonPwdMsg(newMsg, pubkeys, signingKey?.key);
      return {
        senderKi: signingKey?.keyInfo,
        msgs: [msg],
        renderSentMessage: {
          recipients: msg.recipients,
          attachments: msg.attachments // todo: perhaps, we should hide technical attachments, like `encrypted.asc` and use collectedAttachments too?
        }
      };
    }
  };

  public sendableNonPwdMsg = async (newMsg: NewMsgData, pubkeys: PubkeyResult[], signingPrv?: Key): Promise<SendableMsg> => {
    if (!this.isDraft) {
      // S/MIME drafts are currently formatted with inline armored data
      const x509certs = pubkeys.map(entry => entry.pubkey).filter(pub => pub.family === 'x509');
      if (x509certs.length) { // s/mime
        return await this.sendableSmimeMsg(newMsg, x509certs, signingPrv);
      }
    }
    const textToEncrypt = this.richtext
      ? await Mime.encode({ 'text/plain': newMsg.plaintext, 'text/html': newMsg.plainhtml }, { Subject: newMsg.subject },
        this.isDraft ? [] : await this.view.attachmentsModule.attachment.collectAttachments())
      : newMsg.plaintext;
    const { data: encrypted } = await this.encryptDataArmor(Buf.fromUtfStr(textToEncrypt), undefined, pubkeys, signingPrv);
    if (!this.richtext || this.isDraft) {
      // draft richtext messages go inline as gmail makes it hard (or impossible) to render messages saved as https://tools.ietf.org/html/rfc3156
      return await SendableMsg.createInlineArmored(this.acctEmail, this.headers(newMsg), Buf.fromUint8(encrypted).toUtfStr(),
        this.isDraft ? [] : await this.view.attachmentsModule.attachment.collectEncryptAttachments(pubkeys),
        { isDraft: this.isDraft });
    }
    // rich text: PGP/MIME - https://tools.ietf.org/html/rfc3156#section-4
    const attachments = this.formatEncryptedMimeDataAsPgpMimeMetaAttachments(encrypted);
    return await SendableMsg.createPgpMime(this.acctEmail, this.headers(newMsg), attachments, { isDraft: this.isDraft });
  };

  private formatSendablePwdMsgs = async (newMsg: NewMsgData, pubkeys: PubkeyResult[], signingKey?: ParsedKeyInfo) => {
    // password-protected message, temporarily uploaded (already encrypted) to:
    //    - flowcrypt.com/api (consumers and customers without on-prem setup), or
    //    - FlowCrypt Enterprise Server (enterprise customers with on-prem setup)
    //    It will be served to recipient through web
    const uploadedMessageData = await this.prepareAndUploadPwdEncryptedMsg(newMsg); // encrypted for pwd only, pubkeys ignored
    // pwdRecipients that have their personal link
    const individualPwdRecipients = Object.keys(uploadedMessageData.emailToExternalIdAndUrl ?? {}).filter(email => !pubkeys.some(p => p.email === email));
    const legacyPwdRecipients: { [type in RecipientType]?: EmailParts[] } = {};
    newMsg.pwd = undefined;
    const encryptedAttachments = await this.view.attachmentsModule.attachment.collectEncryptAttachments(pubkeys);
    const pubkeyRecipients: { [type in RecipientType]?: EmailParts[] } = {};
    for (const [sendingType, value] of Object.entries(newMsg.recipients)) {
      if (Api.isRecipientHeaderNameType(sendingType)) {
        pubkeyRecipients[sendingType] = value?.filter(emailPart => pubkeys.some(p => p.email === emailPart.email));
        legacyPwdRecipients[sendingType] = value?.filter(
          emailPart => !pubkeys.some(p => p.email === emailPart.email)
            && !individualPwdRecipients.includes(emailPart.email));
      }
    }
    const msgs: SendableMsg[] = [];
    // pubkey recipients get one combined message. If there are not pubkey recpients, only password - protected messages will be sent
    if (pubkeyRecipients.to?.length || pubkeyRecipients.cc?.length || pubkeyRecipients.bcc?.length) {
      const uniquePubkeyRecipientToAndCCs = Value.arr.unique((pubkeyRecipients.to || []).concat(pubkeyRecipients.cc || [])
        .map(recipient => recipient.email.toLowerCase()));
      // pubkey recipients should be able to reply to "to" and "cc" pwd recipients
      const replyToForMessageSentToPubkeyRecipients = (newMsg.recipients.to ?? []).concat(newMsg.recipients.cc ?? [])
        .filter(recipient => !uniquePubkeyRecipientToAndCCs.includes(recipient.email.toLowerCase()));
      const pubkeyMsgData = {
        ...newMsg,
        recipients: pubkeyRecipients,
        // brackets are required for test emails like '@test:8001'
        replyTo: replyToForMessageSentToPubkeyRecipients.length ? `${Str.formatEmailList([newMsg.from, ...replyToForMessageSentToPubkeyRecipients], true)}`
          : undefined
      };
      msgs.push(await this.sendableNonPwdMsg(pubkeyMsgData, pubkeys, signingKey?.key));
    }
    // adding individual messages for each recipient that doesn't have a pubkey
    for (const recipientEmail of individualPwdRecipients) {
      const { url, externalId } = uploadedMessageData.emailToExternalIdAndUrl![recipientEmail];
      const foundParsedRecipient = (newMsg.recipients.to ?? []).concat(newMsg.recipients.cc ?? []).concat(newMsg.recipients.bcc ?? []).
        find(r => r.email.toLowerCase() === recipientEmail.toLowerCase());
      // todo: since a message is allowed to have only `cc` or `bcc` without `to`, should we preserve the original placement(s) of the recipient?
      const individualMsgData = { ...newMsg, recipients: { to: [foundParsedRecipient ?? { email: recipientEmail }] } };
      msgs.push(await this.sendablePwdMsg(individualMsgData, pubkeys, { msgUrl: url, externalId }, signingKey?.key));
    }
    if (legacyPwdRecipients.to?.length || legacyPwdRecipients.cc?.length || legacyPwdRecipients.bcc?.length) {
      const legacyPwdMsgData = { ...newMsg, recipients: legacyPwdRecipients };
      msgs.push(await this.sendablePwdMsg(legacyPwdMsgData, pubkeys, { msgUrl: uploadedMessageData.url }, signingKey?.key));
    }
    return { senderKi: signingKey?.keyInfo, msgs, renderSentMessage: { recipients: newMsg.recipients, attachments: encryptedAttachments } };
  };

  private prepareAndUploadPwdEncryptedMsg = async (newMsg: NewMsgData): Promise<UploadedMessageData> => {
    // PGP/MIME + included attachments (encrypted for password only)
    if (!newMsg.pwd) {
      throw new Error('password unexpectedly missing');
    }
    /**
     * There are two mechanisms to send password protected messages: flowcrypt.com/api and FES
     *  - flowcrypt.com/api is older API, shared instance used by non-enterprise customers
     *  - FES is a more recent API, a dedicated instance that an enterprise customer may run
     * The flowcrypt.com mechanism expects the password to be hashed 100k times, then used
     * The FES mechanism expects the password to be given to OpenPGP.js verbatim
     *
     * Reason: OpenPGP spec already has a mechanism for iterated hashing of passwords,
     *   there is no need to invent our own:
     *   https://datatracker.ietf.org/doc/html/rfc4880#section-3.7.1.3
     *
     * The advantage is that it's dynamic - the sender can choose the rounds of iterations, and
     *   the recipient will follow transparently. For now, we'll be following the default set
     *   in OpenPGP.js, and later we can make a deliberate choice on how many iterations to use
     *   without having to affect recipient code.
     *
     * Another thing to note is that eventually, flowcrypt.com/api web portal functionality will
     *   be deprecated, and we'll instead run a "shared tenant FES instance" to fill that role.
     *   Nothing will change for users, but our code on the client will be more streamlined.
     *   Therefore, eventually, this `if` branch with the line below will be removed once both
     *   consumers and enterprises use API with the same structure.
     */
    if (! await this.view.acctServer.isFesUsed()) { // if flowcrypt.com/api is used
      newMsg.pwd = await PgpHash.challengeAnswer(newMsg.pwd); // then hash the password to preserve compatibility
    }
    const authInfo = await AcctStore.authInfo(this.acctEmail);
    const { bodyWithReplyToken, replyToken } = await this.getPwdMsgSendableBodyWithOnlineReplyMsgToken(authInfo, newMsg);
    const pgpMimeWithAttachments = await Mime.encode(bodyWithReplyToken, { Subject: newMsg.subject }, await this.view.attachmentsModule.attachment.collectAttachments());
    const { data: pwdEncryptedWithAttachments } = await this.encryptDataArmor(Buf.fromUtfStr(pgpMimeWithAttachments), newMsg.pwd, []); // encrypted only for pwd, not signed
    return await this.view.acctServer.messageUpload(
      authInfo.uuid ? authInfo : undefined,
      pwdEncryptedWithAttachments,
      replyToken,
      newMsg.from.email, // todo: Str.formatEmailWithOptionalName?
      newMsg.recipients,
      (p) => this.view.sendBtnModule.renderUploadProgress(p, 'FIRST-HALF'), // still need to upload to Gmail later, this request represents first half of progress
    );
  };

  private sendablePwdMsg = async (
    newMsg: NewMsgData,
    pubs: PubkeyResult[],
    { msgUrl, externalId }: { msgUrl: string, externalId?: string },
    signingPrv?: Key) => {
    // encoded as: PGP/MIME-like structure but with attachments as external files due to email size limit (encrypted for pubkeys only)
    const msgBody = this.richtext ? { 'text/plain': newMsg.plaintext, 'text/html': newMsg.plainhtml } : { 'text/plain': newMsg.plaintext };
    const pgpMimeNoAttachments = await Mime.encode(msgBody, { Subject: newMsg.subject }, []); // no attachments, attached to email separately
    const { data: pubEncryptedNoAttachments } = await this.encryptDataArmor(Buf.fromUtfStr(pgpMimeNoAttachments), undefined, pubs, signingPrv); // encrypted only for pubs
    const emailIntroAndLinkBody = await this.formatPwdEncryptedMsgBodyLink(msgUrl);
    return await SendableMsg.createPwdMsg(this.acctEmail, this.headers(newMsg), emailIntroAndLinkBody,
      this.formatEncryptedMimeDataAsPgpMimeMetaAttachments(pubEncryptedNoAttachments),
      { isDraft: this.isDraft, externalId });
  };

  private sendableSmimeMsg = async (newMsg: NewMsgData, x509certs: Key[], signingPrv?: Key): Promise<SendableMsg> => {
    const plainAttachments: Attachment[] = this.isDraft ? [] : await this.view.attachmentsModule.attachment.collectAttachments();
    const msgBody = { 'text/plain': newMsg.plaintext }; // todo: richtext #4047
    const mimeEncodedPlainMessage = await Mime.encode(msgBody, { Subject: newMsg.subject }, plainAttachments);
    let mimeData = Buf.fromUtfStr(mimeEncodedPlainMessage);
    if (signingPrv) {
      const signedMessage = await this.signMimeMessage(signingPrv, mimeEncodedPlainMessage, newMsg);
      mimeData = Buf.fromUtfStr(await signedMessage.toMime());
    }
    const encryptedMessage = await SmimeKey.encryptMessage({ pubkeys: x509certs, data: mimeData, armor: false });
    return await SendableMsg.createSMimeEncrypted(this.acctEmail, this.headers(newMsg), encryptedMessage.data, { isDraft: this.isDraft });
  };

  private formatEncryptedMimeDataAsPgpMimeMetaAttachments = (data: Uint8Array) => {
    const attachments: Attachment[] = [];
    attachments.push(new Attachment({ data: Buf.fromUtfStr('Version: 1'), type: 'application/pgp-encrypted', contentDescription: 'PGP/MIME version identification' }));
    attachments.push(new Attachment({ data, type: 'application/octet-stream', contentDescription: 'OpenPGP encrypted message', name: 'encrypted.asc', inline: true }));
    return attachments;
  };

  private encryptDataArmor = async (data: Buf, pwd: string | undefined, pubs: PubkeyResult[], signingPrv?: Key): Promise<PgpMsgMethod.EncryptAnyArmorResult> => {
    const pgpPubs = pubs.filter(pub => pub.pubkey.family === 'openpgp');
    const encryptAsOfDate = await this.encryptMsgAsOfDateIfSomeAreExpiredAndUserConfirmedModal(pgpPubs);
    const pubsForEncryption = pubs.map(entry => entry.pubkey);
    return await MsgUtil.encryptMessage({ pubkeys: pubsForEncryption, signingPrv, pwd, data, armor: true, date: encryptAsOfDate }) as PgpMsgMethod.EncryptAnyArmorResult;
  };

  private getPwdMsgSendableBodyWithOnlineReplyMsgToken = async (
    authInfo: FcUuidAuth, newMsgData: NewMsgData
  ): Promise<{ bodyWithReplyToken: SendableMsgBody, replyToken: string }> => {
    const recipients = getUniqueRecipientEmails(newMsgData.recipients);
    try {
      const response = await this.view.acctServer.messageToken(authInfo);
      const infoDiv = Ui.e('div', {
        'style': 'display: none;',
        'class': 'cryptup_reply',
        'cryptup-data': Str.htmlAttrEncode({
          sender: newMsgData.from,
          recipient: Value.arr.withoutVal(Value.arr.withoutVal(recipients, newMsgData.from.email), this.acctEmail),
          subject: newMsgData.subject,
          token: response.replyToken,
        })
      });
      return {
        bodyWithReplyToken: { 'text/plain': newMsgData.plaintext + '\n\n' + infoDiv, 'text/html': newMsgData.plainhtml + '<br /><br />' + infoDiv },
        replyToken: response.replyToken
      };
    } catch (msgTokenErr) {
      if (ApiErr.isAuthErr(msgTokenErr)) {
        Settings.offerToLoginWithPopupShowModalOnErr(this.acctEmail);
        throw new ComposerResetBtnTrigger();
      } else if (ApiErr.isNetErr(msgTokenErr)) {
        throw msgTokenErr;
      }
      throw Catch.rewrapErr(msgTokenErr, 'There was a token error sending this message. Please try again. ' +
        Lang.general.contactIfHappensAgain(!!this.view.fesUrl));
    }
  };

  private encryptMsgAsOfDateIfSomeAreExpiredAndUserConfirmedModal = async (pubs: PubkeyResult[]): Promise<Date | undefined> => {
    if (!pubs.length) {
      return undefined;
    }
    const usableUntil: number[] = [];
    const usableFrom: number[] = [];
    for (const armoredPubkey of pubs) {
      const oneSecondBeforeExpiration = KeyUtil.dateBeforeExpirationIfAlreadyExpired(armoredPubkey.pubkey);
      usableFrom.push(armoredPubkey.pubkey.created);
      if (typeof oneSecondBeforeExpiration !== 'undefined') { // key is expired
        usableUntil.push(oneSecondBeforeExpiration.getTime());
      }
    }
    if (!usableUntil.length) { // none of the keys are expired
      return undefined;
    }
    if (Math.max(...usableUntil) > Date.now()) { // all keys either don't expire or expire in the future
      return undefined;
    }
    const usableTimeFrom = Math.max(...usableFrom);
    const usableTimeUntil = Math.min(...usableUntil);
    if (usableTimeFrom > usableTimeUntil) { // used public keys have no intersection of usable dates
      await Ui.modal.error('The public key of one of your recipients has been expired for too long.\n\nPlease ask the recipient to send you an updated Public Key.');
      throw new ComposerResetBtnTrigger();
    }
    if (! await Ui.modal.confirm(Lang.compose.pubkeyExpiredConfirmCompose)) {
      throw new ComposerResetBtnTrigger();
    }
    return new Date(usableTimeUntil); // latest date none of the keys were expired
  };

  private formatPwdEncryptedMsgBodyLink = async (msgUrl: string): Promise<SendableMsgBody> => {
    const storage = await AcctStore.get(this.acctEmail, ['outgoing_language']);
    const lang = storage.outgoing_language || 'EN';
    const aStyle = `padding: 2px 6px; background: #2199e8; color: #fff; display: inline-block; text-decoration: none;`;
    const a = `<a href="${Xss.escape(msgUrl)}" style="${aStyle}">${Lang.compose.openMsg[lang]}</a>`;
    const intro = this.view.S.cached('input_intro').length ? this.view.inputModule.extract('text', 'input_intro') : undefined;
    const text = [];
    const html = [];
    if (intro) {
      text.push(intro + '\n');
      html.push(Xss.escape(intro).replace(/\n/g, '<br>') + '<br><br>');
    }
    const senderEmail = Xss.escape(this.view.senderModule.getSender());
    text.push(Lang.compose.msgEncryptedText(lang, senderEmail) + msgUrl + '\n\n');
    html.push(`${Lang.compose.msgEncryptedHtml(lang, senderEmail) + a}<br/><br/>${Lang.compose.alternativelyCopyPaste[lang] + Xss.escape(msgUrl)}<br/><br/>`);
    return { 'text/plain': text.join('\n'), 'text/html': html.join('\n') };
  };

}
