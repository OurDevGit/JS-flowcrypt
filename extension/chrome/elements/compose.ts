/* © 2016-2018 FlowCrypt Limited. Limitations apply. Contact human@flowcrypt.com */

'use strict';

import { Store, AccountStoreExtension, Scopes, AccountStore } from '../../js/common/platform/store.js';
import { Ui } from '../../js/common/browser/ui.js';
import { Composer } from './composer/composer.js';
import { Api } from '../../js/common/api/api.js';
import { BrowserMsg } from '../../js/common/browser/browser-msg.js';
import { openpgp } from '../../js/common/core/pgp.js';
import { ReplyParams, EmailProviderInterface } from '../../js/common/api/email_provider/email_provider_api.js';
import { Assert } from '../../js/common/assert.js';
import { XssSafeFactory } from '../../js/common/xss_safe_factory.js';
import { Xss } from '../../js/common/platform/xss.js';
import { Backend } from '../../js/common/api/backend.js';
import { Url } from '../../js/common/core/common.js';
import { View } from '../../js/common/view.js';
import { Gmail } from '../../js/common/api/email_provider/gmail/gmail.js';
import { GmailParser } from '../../js/common/api/email_provider/gmail/gmail-parser.js';

export type DeterminedMsgHeaders = {
  lastMsgId: string,
  headers: { 'In-Reply-To': string, 'References': string }
};

export class ComposeView extends View {

  public readonly acctEmail: string;
  public readonly parentTabId: string;
  public readonly frameId: string;
  public readonly ignoreDraft: boolean;
  public readonly removeAfterClose: boolean;
  public readonly placement: 'settings' | 'gmail' | undefined;
  public readonly disableDraftSaving: boolean;
  public readonly debug: boolean;
  public readonly isReplyBox: boolean;
  public readonly replyMsgId: string;
  public readonly replyPubkeyMismatch: boolean;
  public skipClickPrompt: boolean;
  public draftId: string;
  public threadId: string = '';

  public scopes: Scopes | undefined;
  public tabId: string | undefined;
  public storage: AccountStore | undefined;
  public factory: XssSafeFactory | undefined;
  public replyParams: ReplyParams | undefined;
  public composer: Composer | undefined;
  public emailProvider: EmailProviderInterface;

  constructor() {
    super();
    Ui.event.protect();
    const uncheckedUrlParams = Url.parse(['acctEmail', 'parentTabId', 'draftId', 'placement', 'frameId',
      'replyMsgId', 'skipClickPrompt', 'ignoreDraft', 'debug', 'removeAfterClose', 'replyPubkeyMismatch']);
    this.acctEmail = Assert.urlParamRequire.string(uncheckedUrlParams, 'acctEmail');
    this.parentTabId = Assert.urlParamRequire.string(uncheckedUrlParams, 'parentTabId');
    this.frameId = Assert.urlParamRequire.string(uncheckedUrlParams, 'frameId');
    this.skipClickPrompt = uncheckedUrlParams.skipClickPrompt === true;
    this.ignoreDraft = uncheckedUrlParams.ignoreDraft === true;
    this.removeAfterClose = uncheckedUrlParams.removeAfterClose === true;
    this.placement = Assert.urlParamRequire.oneof(uncheckedUrlParams, 'placement', ['settings', 'gmail', undefined]);
    this.disableDraftSaving = false;
    this.debug = uncheckedUrlParams.debug === true;
    this.replyPubkeyMismatch = uncheckedUrlParams.replyPubkeyMismatch === true;
    this.draftId = Assert.urlParamRequire.optionalString(uncheckedUrlParams, 'draftId') || '';
    this.replyMsgId = Assert.urlParamRequire.optionalString(uncheckedUrlParams, 'replyMsgId') || '';
    this.isReplyBox = !!this.replyMsgId;
    this.emailProvider = new Gmail(this.acctEmail);
    Backend.getSubscriptionWithoutLogin(this.acctEmail).catch(Api.err.reportIfSignificant); // updates storage
    openpgp.initWorker({ path: '/lib/openpgp.worker.js' });
  }

  async render() {
    this.storage = await Store.getAcct(this.acctEmail, ['google_token_scopes', 'addresses', 'sendAs', 'email_provider',
      'hide_message_password', 'drafts_reply']);
    this.tabId = await BrowserMsg.requiredTabId();
    this.factory = new XssSafeFactory(this.acctEmail, this.tabId);
    this.scopes = await Store.getScopes(this.acctEmail);
    if (!this.isReplyBox) { // don't want to deal with resizing the frame
      await Assert.abortAndRenderErrOnUnprotectedKey(this.acctEmail);
    }
    if (this.replyMsgId) {
      await this.fetchReplyMeta();
    }
    if (this.isReplyBox && this.threadId && !this.ignoreDraft && this.storage.drafts_reply && this.storage.drafts_reply[this.threadId]) {
      this.draftId = this.storage.drafts_reply[this.threadId]; // there may be a draft we want to load
    }
    this.composer = new Composer(this);
  }

  setHandlers() {
    // all handled in Composer
  }

  public urlParams() { // used to reload the frame with updated params
    return {
      acctEmail: this.acctEmail, draftId: this.draftId, threadId: this.threadId, replyMsgId: this.replyMsgId, ...this.replyParams,
      frameId: this.frameId, tabId: this.tabId!, isReplyBox: this.isReplyBox, skipClickPrompt: this.skipClickPrompt, parentTabId: this.parentTabId,
      disableDraftSaving: this.disableDraftSaving, debug: this.debug, removeAfterClose: this.removeAfterClose, placement: this.placement,
      replyPubkeyMismatch: this.replyPubkeyMismatch,
    };
  }

  private async fetchReplyMeta(): Promise<void> {
    Xss.sanitizePrepend('#new_message', Ui.e('div', { id: 'loader', html: `Loading secure reply box..${Ui.spinner('green')}` }));
    try {
      const gmailMsg = await this.emailProvider.msgGet(this.replyMsgId!, 'metadata');
      const aliases = AccountStoreExtension.getEmailAliasesIncludingPrimary(this.acctEmail, this.storage!.sendAs);
      this.replyParams = GmailParser.determineReplyMeta(this.acctEmail, aliases, gmailMsg);
      this.threadId = gmailMsg.threadId || '';
    } catch (e) {
      if (Api.err.isAuthPopupNeeded(e)) {
        BrowserMsg.send.notificationShowAuthPopupNeeded(this.parentTabId, { acctEmail: this.acctEmail });
      }
      if (e instanceof Error) {
        e.message = `Cannot get reply data for the message you are replying to.`;
      }
      throw e;
    } finally {
      $('#loader').remove();
    }
  }

}

View.run(ComposeView);
