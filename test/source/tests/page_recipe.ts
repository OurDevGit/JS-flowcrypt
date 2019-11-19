
import { BrowserHandle, ControllablePage, ControllableFrame, Controllable, Url } from '../browser';
import { Util, Config } from '../util';
import { expect } from 'chai';
import { AvaContext } from '.';
import { CommonBrowserGroup } from '../test';
import { FlowCryptApi } from './api';
import { EvaluateFn, ElementHandle } from 'puppeteer';
import { totp as produce2faToken } from 'speakeasy';

export class PageRecipe {
  public static getElementPropertyJson = async (elem: ElementHandle<Element>, property: string) => await (await elem.getProperty(property)).jsonValue() as string;

  public static waitForModalAndRespond = async (controllable: Controllable, name: 'confirm' | 'error', { contentToCheck, clickOn }:
    { contentToCheck?: string, clickOn?: 'confirm' | 'cancel' }) => {
    const modalContainer = await controllable.waitAny(`.ui-modal-${name}`);
    if (typeof contentToCheck !== 'undefined') {
      const contentElement = await modalContainer.$('#swal2-content');
      expect(await PageRecipe.getElementPropertyJson(contentElement!, 'textContent')).to.include(contentToCheck);
    }
    if (clickOn) {
      const button = await modalContainer.$(`button.ui-modal-${name}-${clickOn}`);
      await button!.click();
    }
  }
}

type RecipientType = "to" | "cc" | "bcc";
type Recipients = {
  [key in RecipientType]?: string;
};

type ManualEnterOpts = { usedPgpBefore?: boolean, submitPubkey?: boolean, fixKey?: boolean, naked?: boolean, genPp?: boolean, simulateRetryOffline?: boolean };

export class SetupPageRecipe extends PageRecipe {

  private static createBegin = async (settingsPage: ControllablePage, keyTitle: string, { usedPgpBefore = false }: { usedPgpBefore?: boolean } = {}) => {
    const k = Config.key(keyTitle);
    if (usedPgpBefore) {
      await settingsPage.waitAndClick('@action-step0foundkey-choose-manual-create');
    } else {
      await settingsPage.waitAndClick('@action-step1easyormanual-choose-manual-create');
    }
    await settingsPage.waitAndType('@input-step2bmanualcreate-passphrase-1', k.passphrase);
    await settingsPage.waitAndType('@input-step2bmanualcreate-passphrase-2', k.passphrase);
  }

  // public static setup_create_simple = async (settingsPage: ControllablePage, key_title: string, {used_pgp_before=false}: {used_pgp_before?: boolean}={}) => {
  //   await PageRecipe.setup_create_begin(settingsPage, key_title, {used_pgp_before});
  //   await settingsPage.wait_and_click('@input-step2bmanualcreate-create-and-save');
  //   await settingsPage.wait_and_click('@action-backup-....');
  //   // todo
  //   await settingsPage.wait_and_click('@action-step4done-account-settings');
  // }

  // tslint:disable-next-line:max-line-length
  public static createAdvanced = async (settingsPage: ControllablePage, keyTitle: string, backup: "none" | "email" | "file", { usedPgpBefore = false, submitPubkey = false }: { usedPgpBefore?: boolean, submitPubkey?: boolean } = {}) => {
    await SetupPageRecipe.createBegin(settingsPage, keyTitle, { usedPgpBefore });
    await settingsPage.waitAndClick('@action-step2bmanualcreate-show-advanced-create-settings'); // unfold
    await settingsPage.waitAndClick('@input-step2bmanualcreate-backup-inbox'); // uncheck
    if (!submitPubkey) {
      await settingsPage.waitAndClick('@input-step2bmanualcreate-submit-pubkey'); // uncheck
    }
    await settingsPage.waitAndClick('@input-step2bmanualcreate-create-and-save');
    await settingsPage.waitAndRespondToModal('confirm-checkbox', 'confirm', 'Please write down your pass phrase');
    if (backup === 'none') {
      await settingsPage.waitAll('@input-backup-step3manual-no-backup', { timeout: 60 });
      await settingsPage.waitAndClick('@input-backup-step3manual-no-backup');
    } else if (backup === 'email') {
      throw new Error('tests.setup_manual_create options.backup=email not implemented');
    } else if (backup === 'file') {
      throw new Error('tests.setup_manual_create options.backup=file not implemented');
    }
    await settingsPage.waitAndClick('@action-backup-step3manual-continue');
    await settingsPage.waitAndClick('@action-step4done-account-settings');
    await SettingsPageRecipe.ready(settingsPage);
  }

  // tslint:disable-next-line:max-line-length
  public static manualEnter = async (
    settingsPage: ControllablePage,
    keyTitle: string,
    { usedPgpBefore = false, submitPubkey = false, fixKey = false, naked = false, genPp = false, simulateRetryOffline = false }: ManualEnterOpts = {}
  ) => {
    const k = Config.key(keyTitle);
    if (usedPgpBefore) {
      await settingsPage.waitAndClick('@action-step0foundkey-choose-manual-enter', { retryErrs: true });
    } else {
      await settingsPage.waitAndClick('@action-step1easyormanual-choose-manual-enter', { retryErrs: true });
    }
    await settingsPage.waitAndClick('@input-step2bmanualenter-source-paste');
    await settingsPage.waitAndType('@input-step2bmanualenter-ascii-key', k.armored || '');
    await settingsPage.waitAndClick('@input-step2bmanualenter-passphrase'); // blur ascii key input
    if (!naked) {
      await Util.sleep(1);
      await settingsPage.notPresent('@action-step2bmanualenter-new-random-passphrase');
      await settingsPage.waitAndType('@input-step2bmanualenter-passphrase', k.passphrase);
    } else {
      await settingsPage.waitAndClick('@input-step2bmanualenter-passphrase');
      await settingsPage.waitAll('@action-step2bmanualenter-new-random-passphrase', { visible: true });
      if (genPp) {
        await settingsPage.waitAndClick('@action-step2bmanualenter-new-random-passphrase');
        await Util.sleep(1);
        const generatedPp = await settingsPage.value('@input-step2bmanualenter-passphrase');
        if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(generatedPp)) {
          throw new Error(`Import naked key page did not generate proper pass phrase, instead got: ${generatedPp}`);
        }
        const ppValidationExpect = 'GREAT (time to crack: centuries)';
        const ppValidationResult = await settingsPage.read('@container-password-feedback', true);
        if (!ppValidationResult.includes(ppValidationExpect)) {
          throw new Error(`Incorrect Passphrase validation result, expected '${ppValidationExpect}' but got ${ppValidationResult}`);
        }
      } else {
        await settingsPage.waitAndType('@input-step2bmanualenter-passphrase', k.passphrase);
      }
    }
    if (!submitPubkey) {
      await settingsPage.waitAndClick('@input-step2bmanualenter-submit-pubkey'); // uncheck
    }
    await settingsPage.waitAll('@input-step2bmanualenter-save');
    try {
      if (simulateRetryOffline) {
        await settingsPage.page.setOfflineMode(true); // offline mode
      }
      await settingsPage.waitAndClick('@input-step2bmanualenter-save', { delay: 1 });
      if (fixKey) {
        await settingsPage.waitAll('@input-compatibility-fix-expire-years');
        await settingsPage.selectOption('@input-compatibility-fix-expire-years', '1');
        await settingsPage.waitAndClick('@action-fix-and-import-key');
      }
      if (simulateRetryOffline) {
        await settingsPage.waitAll(['@action-overlay-retry', '@container-overlay-prompt-text', '@action-show-overlay-details'], { timeout: fixKey ? 45 : 20 });
        await Util.sleep(0.5);
        expect(await settingsPage.read('@container-overlay-prompt-text')).to.contain('Network connection issue');
        await settingsPage.click('@action-show-overlay-details');
        await settingsPage.waitAll('@container-overlay-details');
        await Util.sleep(0.5);
        expect(await settingsPage.read('@container-overlay-details')).to.contain('Error stack');
        await settingsPage.page.setOfflineMode(false); // back online
        await settingsPage.click('@action-overlay-retry');
        // after retry, the rest should continue as usual below
      }
      await settingsPage.waitAll('@action-step4done-account-settings', { timeout: fixKey ? 90 : 20 });
      await settingsPage.waitAndClick('@action-step4done-account-settings');
      await SettingsPageRecipe.ready(settingsPage);
    } finally {
      await settingsPage.page.setOfflineMode(false); // in case this tab is reused for other tests (which it shouldn't)
    }
  }

  // tslint:disable-next-line:max-line-length
  public static recover = async (settingsPage: ControllablePage, keyTitle: string, { wrongPp = false, clickRecoverMore = false, hasRecoverMore = false, alreadyRecovered = false }: { wrongPp?: boolean, clickRecoverMore?: boolean, hasRecoverMore?: boolean, alreadyRecovered?: boolean } = {}) => {
    const k = Config.key(keyTitle);
    await settingsPage.waitAll('@input-recovery-pass-phrase', { timeout: 40 }); // can sometimes be slow
    await settingsPage.waitAndType('@input-recovery-pass-phrase', k.passphrase);
    await settingsPage.waitAndClick('@action-recover-account');
    if (wrongPp) {
      await settingsPage.waitAndRespondToModal('warning', 'confirm', 'not match');
    } else if (alreadyRecovered) {
      await settingsPage.waitAndRespondToModal('warning', 'confirm', 'matches a key that was already recovered');
    } else {
      await settingsPage.waitAny(['@action-step4more-account-settings', '@action-step4done-account-settings'], { timeout: 60 });
      if (hasRecoverMore) {
        await settingsPage.waitAll(['@action-step4more-account-settings', '@action-step4more-recover-remaining']);
        if (clickRecoverMore) {
          await settingsPage.waitAndClick('@action-step4more-recover-remaining');
        } else {
          await settingsPage.waitAndClick('@action-step4more-account-settings');
          await SettingsPageRecipe.ready(settingsPage);
        }
      } else {
        await settingsPage.waitAll('@action-step4done-account-settings');
        if (clickRecoverMore) {
          throw new Error('Invalid options chosen: has_recover_more: false, click_recover_more: true');
        } else {
          await settingsPage.waitAndClick('@action-step4done-account-settings');
          await SettingsPageRecipe.ready(settingsPage);
        }
      }
    }
  }

}

export class SettingsPageRecipe extends PageRecipe {

  public static ready = async (settingsPage: ControllablePage) => {
    await settingsPage.waitAll('@page-settings');
    await settingsPage.waitForSelTestState('ready');
  }

  public static toggleScreen = async (settingsPage: ControllablePage, to: "basic" | "additional") => {
    await SettingsPageRecipe.ready(settingsPage);
    await Util.sleep(0.5);
    await settingsPage.waitAndClick(to === 'basic' ? '@action-toggle-screen-basic' : '@action-toggle-screen-additional'); // switch
    await Util.sleep(0.5);
    await settingsPage.waitAll(to === 'basic' ? '@action-toggle-screen-additional' : '@action-toggle-screen-basic'); // wait for opposite button to show up
    await Util.sleep(0.5);
  }

  public static closeDialog = async (settingsPage: ControllablePage) => {
    await settingsPage.waitAndClick('@dialog-close', { delay: 3 });
    await settingsPage.waitTillGone('@dialog');
  }

  public static awaitNewPageFrame = async (settingsPage: ControllablePage, actionBtnSel: string, frameUrlFilter: string[]): Promise<ControllableFrame> => {
    await SettingsPageRecipe.ready(settingsPage);
    await settingsPage.waitAndClick(actionBtnSel);
    await settingsPage.waitAll('@dialog');
    return await settingsPage.getFrame(frameUrlFilter); // placement=settings to differentiate from mini-security frame in settings
  }

  public static swithAcct = async (settingsPage: ControllablePage, acctEmail: string) => {
    await SettingsPageRecipe.ready(settingsPage);
    await settingsPage.waitAndClick('@action-toggle-accounts-menu');
    await settingsPage.waitAndClick(`@action-switch-to-account(${acctEmail})`);
  }

  public static changePassphrase = async (settingsPage: ControllablePage, currentPp: string | undefined, newPp: string) => {
    await SettingsPageRecipe.ready(settingsPage);
    const securityFrame = await SettingsPageRecipe.awaitNewPageFrame(settingsPage, '@action-open-security-page', ['security.htm', 'placement=settings']);
    await securityFrame.waitAndClick('@action-change-passphrase-begin', { delay: 1 });
    if (currentPp) {
      await securityFrame.waitAndType('@input-current-pp', currentPp, { delay: 1 });
      await securityFrame.waitAndClick('@action-confirm-current-pp', { delay: 1 });
    }
    await securityFrame.waitAndType('@input-new-pp', newPp, { delay: 1 });
    await securityFrame.waitAndClick('@action-show-confirm-new-pp', { delay: 1 });
    await securityFrame.waitAndType('@input-confirm-new-pp', newPp, { delay: 1 });
    await securityFrame.waitAndClick('@action-confirm-new-pp', { delay: 1 });
    await securityFrame.waitAndRespondToModal('info', 'confirm', 'Now that you changed your pass phrase, you should back up your key');
    await securityFrame.waitAll('@container-backup-dialog'); // offers a new backup
    await Util.sleep(3);
    await SettingsPageRecipe.closeDialog(settingsPage);
  }

  public static forgetAllPassPhrasesInStorage = async (settingsPage: ControllablePage, passphrase: string) => {
    await SettingsPageRecipe.ready(settingsPage);
    const securityFrame = await SettingsPageRecipe.awaitNewPageFrame(settingsPage, '@action-open-security-page', ['security.htm', 'placement=settings']);
    await securityFrame.waitAndClick('@action-forget-pp');
    await securityFrame.waitAndType('@input-confirm-pass-phrase', passphrase);
    await securityFrame.waitAndClick('@action-confirm-pass-phrase-requirement-change');
    await SettingsPageRecipe.closeDialog(settingsPage);
  }

  public static verifyMyKeyPage = async (settingsPage: ControllablePage, expectedKeyName: string, trigger: "button" | "link", linkIndex?: number) => {
    await SettingsPageRecipe.ready(settingsPage);
    await SettingsPageRecipe.toggleScreen(settingsPage, 'additional');
    const myKeyFrame = await SettingsPageRecipe.awaitNewPageFrame(settingsPage,
      trigger === 'button' ? '@action-open-pubkey-page' : `@action-show-key-${linkIndex}`, ['my_key.htm', 'placement=settings']);
    await Util.sleep(1);
    const k = Config.key(expectedKeyName);
    await myKeyFrame.waitAll('@content-key-words');
    expect(await myKeyFrame.read('@content-key-words')).to.equal(k.keywords);
    await SettingsPageRecipe.closeDialog(settingsPage);
    await SettingsPageRecipe.toggleScreen(settingsPage, 'basic');
  }

  public static passphraseTest = async (settingsPage: ControllablePage, passphrase: string, expectMatch: boolean) => {
    await SettingsPageRecipe.ready(settingsPage);
    const securityFrame = await SettingsPageRecipe.awaitNewPageFrame(settingsPage, '@action-open-security-page', ['security.htm', 'placement=settings']);
    await securityFrame.waitAndClick('@action-test-passphrase-begin');
    await securityFrame.waitAndType('@input-test-passphrase', passphrase);
    await securityFrame.waitAndClick('@action-test-passphrase');
    if (expectMatch) {
      await securityFrame.waitAndClick('@action-test-passphrase-successful-close');
    } else {
      await securityFrame.waitAndRespondToModal('warning', 'confirm', 'not match');
      await SettingsPageRecipe.closeDialog(settingsPage);
    }
    await settingsPage.waitTillGone('@dialog');
  }

}

type CheckDecryptMsg$opt = { acctEmail: string, threadId: string, expectedContent: string, enterPp?: string, finishCurrentSession?: boolean };
type CheckSentMsg$opt = { acctEmail: string, subject: string, expectedContent?: string, isEncrypted?: boolean, isSigned?: boolean, sender?: string };

export class InboxPageRecipe extends PageRecipe {

  public static checkDecryptMsg = async (t: AvaContext, browser: BrowserHandle, { acctEmail, threadId, enterPp, expectedContent, finishCurrentSession }: CheckDecryptMsg$opt) => {
    const inboxPage = await browser.newPage(t, Url.extension(`chrome/settings/inbox/inbox.htm?acctEmail=${acctEmail}&threadId=${threadId}`));
    await inboxPage.waitAll('iframe');
    if (finishCurrentSession) {
      await inboxPage.waitAndClick('@finish-session');
    }
    const pgpBlockFrame = await inboxPage.getFrame(['pgp_block.htm']);
    await pgpBlockFrame.waitAll('@pgp-block-content');
    await pgpBlockFrame.waitForSelTestState('ready');
    if (enterPp) {
      await inboxPage.notPresent("@finish-session");
      await pgpBlockFrame.waitAndClick('@action-show-passphrase-dialog', { delay: 1 });
      await inboxPage.waitAll('@dialog-passphrase');
      const ppFrame = await inboxPage.getFrame(['passphrase.htm']);
      await ppFrame.waitAndType('@input-pass-phrase', enterPp);
      await ppFrame.waitAndClick('@action-confirm-pass-phrase-entry', { delay: 1 });
      await pgpBlockFrame.waitForSelTestState('ready');
      await inboxPage.waitAll('@finish-session');
      await Util.sleep(1);
    }
    const content = await pgpBlockFrame.read('@pgp-block-content');
    if (content.indexOf(expectedContent) === -1) {
      throw new Error(`message did not decrypt`);
    }
    await inboxPage.close();
  }

  public static checkFinishingSession = async (t: AvaContext, browser: BrowserHandle, acctEmail: string, threadId: string) => {
    const inboxPage = await browser.newPage(t, Url.extension(`chrome/settings/inbox/inbox.htm?acctEmail=${acctEmail}&threadId=${threadId}`));
    await inboxPage.waitAll('iframe');
    await inboxPage.waitAndClick('@finish-session');
    const pgpBlockFrame = await inboxPage.getFrame(['pgp_block.htm']);
    await pgpBlockFrame.waitAll('@pgp-block-content');
    await pgpBlockFrame.waitForSelTestState('ready');
    await pgpBlockFrame.waitAndClick('@action-show-passphrase-dialog', { delay: 1 });
    await inboxPage.waitAll('@dialog-passphrase');
  }

  public static checkSentMsg = async (t: AvaContext, browser: BrowserHandle, { acctEmail, subject, expectedContent, isEncrypted, isSigned, sender }: CheckSentMsg$opt) => {
    if (typeof isSigned !== 'undefined') {
      throw new Error('checkSentMsg.isSigned not implemented');
    }
    if (typeof expectedContent !== 'undefined') {
      throw new Error('checkSentMsg.expectedContent not implemented');
    }
    if (typeof isEncrypted !== 'undefined') {
      throw new Error('checkSentMsg.isEncrypted not implemented');
    }
    const inboxPage = await browser.newPage(t, Url.extension(`chrome/settings/inbox/inbox.htm?acctEmail=${acctEmail}&labelId=SENT`));
    await inboxPage.waitAndClick(`@container-subject(${subject})`, { delay: 1 });
    if (sender) { // make sure it was sent from intended addr
      await inboxPage.waitAll(`@container-msg-header(${sender})`);
    }
    await inboxPage.close();
  }

}

export class ComposePageRecipe extends PageRecipe {

  public static openStandalone = async (
    t: AvaContext, browser: BrowserHandle, group: CommonBrowserGroup | string, options:
      { appendUrl?: string, hasReplyPrompt?: boolean, skipClickPropt?: boolean, skipValidation?: boolean, initialScript?: EvaluateFn } = {}
  ): Promise<ControllablePage> => {
    if (group === 'compatibility') { // More common accounts
      group = 'flowcrypt.compatibility@gmail.com';
    } else if (group === 'compose') {
      group = 'test.ci.compose@org.flowcrypt.com';
    }
    const email = encodeURIComponent(group);
    const composePage = await browser.newPage(t, `chrome/elements/compose.htm?account_email=${email}&parent_tab_id=0&debug=___cu_true___&frameId=none&${options.appendUrl || ''}`,
      options.initialScript);
    // await composePage.page.on('console', msg => console.log(`compose-dbg:${msg.text()}`));
    if (!options.skipValidation) {
      if (!options.hasReplyPrompt) {
        await composePage.waitAll(['@input-body', '@input-subject', '@action-send']);
        await composePage.waitAny(['@action-show-container-cc-bcc-buttons', '@container-cc-bcc-buttons']);
      } else {
        if (options.skipClickPropt) {
          await Util.sleep(2);
        } else {
          await composePage.waitAll(['@action-accept-reply-prompt']);
        }
      }
      await composePage.waitForSelTestState('ready');
    }
    return composePage;
  }

  public static openReplyKeyMismatch = async (
    t: AvaContext, browser: BrowserHandle, group: CommonBrowserGroup, appendUrl?: string
  ): Promise<ControllablePage> => {
    const email = (group === 'compose') ? 'test.ci.compose%40org.flowcrypt.com' : 'flowcrypt.compatibility%40gmail.com';
    const composePage = await browser.newPage(t, `chrome/elements/reply_pubkey_mismatch.htm?account_email=${email}&parent_tab_id=0&debug=___cu_true___&frameId=none&${appendUrl || ''}`);
    await composePage.waitForSelTestState('ready');
    return composePage;
  }

  public static openInSettings = async (settingsPage: ControllablePage): Promise<ControllableFrame> => {
    await settingsPage.waitAndClick('@action-show-compose-page');
    await settingsPage.waitAll('@dialog');
    const composeFrame = await settingsPage.getFrame(['compose.htm']);
    await composeFrame.waitAll(['@input-body', '@input-subject', '@action-send', '@container-cc-bcc-buttons']);
    await composeFrame.waitForSelTestState('ready');
    return composeFrame;
  }

  public static fillMsg = async (
    composePageOrFrame: Controllable,
    recipients: Recipients,
    subject?: string | undefined,
    sendingOpt: { encrypt?: boolean, sign?: boolean } = {}, // undefined means leave default
    windowType: 'new' | 'reply' = 'new'
  ) => {
    await Util.sleep(0.5);
    await ComposePageRecipe.fillRecipients(composePageOrFrame, recipients, windowType);
    if (subject) {
      await composePageOrFrame.click('@input-subject');
      await Util.sleep(1);
      await composePageOrFrame.type('@input-subject', `Automated puppeteer test: ${subject}`);
    }
    const body = `This is an automated puppeteer test: ${subject || '(no-subject)'}`;
    await composePageOrFrame.type('@input-body', body);
    const sendingOpts = sendingOpt as { [key: string]: boolean | undefined };
    for (const opt of Object.keys(sendingOpts)) {
      const shouldBeTicked = sendingOpts[opt];
      if (typeof shouldBeTicked !== 'undefined') {
        await composePageOrFrame.waitAndClick('@action-show-options-popover');
        await composePageOrFrame.waitAll('@container-sending-options');
        const isCurrentlyTicked = await composePageOrFrame.isElementPresent(`@icon-toggle-${opt}-tick`);
        if ((!isCurrentlyTicked && shouldBeTicked) || (isCurrentlyTicked && !shouldBeTicked)) { // not in desired state
          await composePageOrFrame.waitAndClick(`@action-toggle-${opt}`); // toggling should set it to desired state
        } else { // in desired state
          await composePageOrFrame.waitAndClick('@input-body'); // close popover
        }
        await composePageOrFrame.waitTillGone('@container-sending-options');
      }
    }
    return { subject, body };
  }

  public static fillRecipients = async (composePageOrFrame: Controllable, recipients: Recipients, windowType: 'new' | 'reply') => {
    if (windowType === 'reply') { // new messages should already have cc/bcc buttons visible, because they should have recipients in focus
      await composePageOrFrame.waitAndClick('@action-show-container-cc-bcc-buttons');
    }
    await composePageOrFrame.waitAll('@container-cc-bcc-buttons');
    for (const key of Object.keys(recipients)) {
      const sendingType = key as RecipientType;
      const email = recipients[sendingType] as string | undefined;
      if (email) {
        if (sendingType !== 'to') { // input-to is always visible
          await composePageOrFrame.waitAndClick(`@action-show-${sendingType}`);
        }
        await composePageOrFrame.waitAndType(`@input-${sendingType}`, email);
        await Util.sleep(1);
      }
    }
    if (composePageOrFrame instanceof ControllablePage) {
      await composePageOrFrame.page.evaluate(() => { $('#input_text').focus(); });
      await Util.sleep(1);
    }
  }

  public static sendAndClose = async (composePage: ControllablePage, password?: string | undefined, timeout = 60) => {
    if (password) {
      await composePage.waitAndType('@input-password', 'test-pass');
    }
    await composePage.waitAndClick('@action-send', { delay: 1 });
    await Promise.race([
      composePage.waitForSelTestState('closed', timeout), // in case this was a new message compose
      composePage.waitAny('@container-reply-msg-successful', { timeout }) // in case of reply
    ]);
    await composePage.close();
  }

}

export class OauthPageRecipe extends PageRecipe {

  private static oauthPwdDelay = 2;
  private static longTimeout = 40;

  public static google = async (t: AvaContext, oauthPage: ControllablePage, acctEmail: string, action: "close" | "deny" | "approve"): Promise<void> => {
    const isMock = oauthPage.target.url().includes('localhost');
    const auth = Config.secrets.auth.google.find(a => a.email === acctEmail)!;
    const selectors = {
      backup_email_verification_choice: "//div[@class='vdE7Oc' and text() = 'Confirm your recovery email']",
      approve_button: '#submit_approve_access',
      pwd_input: 'input[type="password"]', // pwd_input: '.zHQkBf',
      pwd_confirm_btn: '.CwaK9',
      secret_2fa: '#totpPin',
    };
    const enterPwdAndConfirm = async () => {
      await Util.sleep(OauthPageRecipe.oauthPwdDelay);
      await oauthPage.waitAndType(selectors.pwd_input, auth.password, { delay: OauthPageRecipe.oauthPwdDelay });
      await oauthPage.waitAndClick(selectors.pwd_confirm_btn, { delay: 1 });  // confirm password
      await oauthPage.waitForNavigationIfAny();
    };
    try {
      await oauthPage.waitAny('#Email, #submit_approve_access, #identifierId, .w6VTHd, #profileIdentifier', { timeout: 45 });
      if (await oauthPage.target.$('#Email') !== null) { // 2016-style login
        await oauthPage.waitAll('#Email', { timeout: OauthPageRecipe.longTimeout });
        await oauthPage.waitAndType('#Email', auth.email);
        await oauthPage.waitAndClick('#next');
        await oauthPage.waitForNavigationIfAny();
        await Util.sleep(OauthPageRecipe.oauthPwdDelay);
        await oauthPage.waitAndType('#Passwd', auth.password, { delay: OauthPageRecipe.oauthPwdDelay });
        await oauthPage.waitForNavigationIfAny();
        await oauthPage.waitAndClick('#signIn', { delay: 1 });
        await oauthPage.waitForNavigationIfAny();
      } else if (await oauthPage.target.$('#identifierId') !== null) { // 2017-style login
        await oauthPage.waitAll('#identifierId', { timeout: OauthPageRecipe.longTimeout });
        await oauthPage.waitAndType('#identifierId', auth.email, { delay: 2 });
        await oauthPage.waitAndClick('.zZhnYe', { delay: 2 });  // confirm email
        await oauthPage.waitForNavigationIfAny();
        await enterPwdAndConfirm();
        console.log('a');
      } else if (await oauthPage.target.$(`#profileIdentifier[data-email="${auth.email}"]`) !== null) { // already logged in - just choose an account
        await oauthPage.waitAndClick(`#profileIdentifier[data-email="${auth.email}"]`, { delay: 1 });
      } else if (await oauthPage.target.$('.w6VTHd') !== null) { // select from accounts where already logged in
        await oauthPage.waitAndClick('.bLzI3e', { delay: 1 }); // choose other account, also try .TnvOCe .k6Zj8d .XraQ3b
        await Util.sleep(isMock ? 0 : 2);
        return await OauthPageRecipe.google(t, oauthPage, acctEmail, action); // start from beginning after clicking "other email acct"
      }
      await Util.sleep(isMock ? 0 : 5);
      const element = await oauthPage.waitAny([selectors.approve_button, selectors.backup_email_verification_choice, selectors.pwd_input, selectors.secret_2fa]);
      await Util.sleep(isMock ? 0 : 1);
      if (await oauthPage.isElementPresent(selectors.backup_email_verification_choice)) { // asks for registered backup email
        await element.click();
        await oauthPage.waitAndType('#knowledge-preregistered-email-response', auth.backup, { delay: 2 });
        await oauthPage.waitAndClick('#next', { delay: 2 });
      } else if (await oauthPage.isElementPresent(selectors.pwd_input)) {
        await enterPwdAndConfirm(); // unsure why it requires a password second time, but sometimes happens
      } else if (await oauthPage.isElementPresent(selectors.secret_2fa)) {
        if (!auth.secret_2fa) {
          throw Error(`Google account ${auth.email} requires a 2fa but missing 2fa secret`);
        }
        const token = produce2faToken({ secret: auth.secret_2fa, encoding: 'base32' });
        await oauthPage.waitAndType(selectors.secret_2fa, token);
        await oauthPage.waitAndClick('#totpNext', { delay: 2 });
      }
      await oauthPage.waitAll('#submit_approve_access'); // if succeeds, we are logged in and presented with approve/deny choice
      // since we are successfully logged in, we may save cookies to keep them fresh
      // no need to await the API call because it's not crucial to always save it, can mostly skip errors
      FlowCryptApi.hookCiCookiesSet(auth.email, await oauthPage.page.cookies()).catch(e => console.error(String(e)));
      if (action === 'close') {
        await oauthPage.close();
      } else if (action === 'deny') {
        throw new Error('tests.handle_gmail_oauth options.deny.true not implemented');
      } else {
        await oauthPage.waitAndClick('#submit_approve_access', { delay: 1 });
      }
    } catch (e) {
      const eStr = String(e);
      if (eStr.indexOf('Execution context was destroyed') === -1 && eStr.indexOf('Cannot find context with specified id') === -1) {
        throw e; // not a known retriable error
      }
      // t.log(`Attempting to retry google auth:${action} on the same window for ${email} because: ${eStr}`);
      return await OauthPageRecipe.google(t, oauthPage, acctEmail, action); // retry, it should pick up where it left off
    }
  }

}

export class GmailPageRecipe extends PageRecipe {

  public static openSecureCompose = async (t: AvaContext, gmailPage: ControllablePage, browser: BrowserHandle): Promise<ControllablePage> => {
    await gmailPage.waitAndClick('@action-secure-compose', { delay: 1 });
    await gmailPage.waitAll('@container-new-message');
    const urls = await gmailPage.getFramesUrls(['/chrome/elements/compose.htm'], { sleep: 1 });
    expect(urls.length).to.equal(1);
    return await browser.newPage(t, urls[0]);
  }

  public static getSubscribeDialog = async (t: AvaContext, gmailPage: ControllablePage, browser: BrowserHandle): Promise<ControllablePage> => {
    await gmailPage.waitAll('@dialog-subscribe');
    const urls = await gmailPage.getFramesUrls(['/chrome/elements/subscribe.htm'], { sleep: 1 });
    expect(urls.length).to.equal(1);
    return await browser.newPage(t, urls[0]);
  }

  public static closeInitialSetupNotif = async (gmailPage: ControllablePage) => {
    await gmailPage.waitAndClick('@notification-successfully-setup-action-close');
  }

}
