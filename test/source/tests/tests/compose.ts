import { TestWithBrowser, TestWithGlobalBrowser } from '..';
import { ComposePageRecipe, SettingsPageRecipe, InboxPageRecipe } from '../page_recipe';
import { BrowserRecipe } from '../browser_recipe';
import { Url } from '../../browser';
import * as ava from 'ava';
import { Util, Config } from '../../util';
import { TestVariant } from '../../test';

export const defineComposeTests = (testVariant: TestVariant, testWithNewBrowser: TestWithBrowser, testWithSemaphoredGlobalBrowser: TestWithGlobalBrowser) => {

  ava.test('compose - standalone - can set and remember default send address', testWithNewBrowser(async (t, browser) => {
    await BrowserRecipe.setUpCommonAcct(t, browser, 'compatibility');
    let composePage = await ComposePageRecipe.openStandalone(t, browser, 'compatibility');
    await ComposePageRecipe.changeDefSendingAddr(composePage, 'flowcrypt.compatibility@gmail.com');
    await composePage.close();
    composePage = await ComposePageRecipe.openStandalone(t, browser, 'compatibility');
    let currentlySelectedFrom = await composePage.value('@input-from');
    if (currentlySelectedFrom !== 'flowcrypt.compatibility@gmail.com') {
      throw new Error('did not remember selected from addr: flowcrypt.compatibility@gmail.com');
    }
    await ComposePageRecipe.changeDefSendingAddr(composePage, 'flowcryptcompatibility@gmail.com');
    await composePage.close();
    composePage = await ComposePageRecipe.openStandalone(t, browser, 'compatibility');
    currentlySelectedFrom = await composePage.value('@input-from');
    if (currentlySelectedFrom !== 'flowcryptcompatibility@gmail.com') {
      throw new Error('did not remember selected from addr: flowcryptcompatibility@gmail.com');
    }
    await ComposePageRecipe.changeDefSendingAddr(composePage, 'flowcrypt.compatibility@gmail.com');
    await composePage.close();
  }));

  ava.test('compose - standalone - signed with entered pass phrase + will remember pass phrase in session', testWithNewBrowser(async (t, browser) => {
    // console.info(`ava.test.timeout.1`);
    const k = Config.key('test.ci.compose');
    // console.info(`ava.test.timeout.2`);
    await BrowserRecipe.setUpCommonAcct(t, browser, 'compose');
    // console.info(`ava.test.timeout.3`);
    const settingsPage = await browser.newPage(t, Url.extensionSettings('test.ci.compose@org.flowcrypt.com'));
    // console.info(`ava.test.timeout.4`);
    await SettingsPageRecipe.changePassphraseRequirement(settingsPage, k.passphrase, 'session');
    // console.info(`ava.test.timeout.5`);
    const composeFrame = await ComposePageRecipe.openInSettings(settingsPage);
    // console.info(`ava.test.timeout.6`);
    await ComposePageRecipe.fillMsg(composeFrame, 'human@flowcrypt.com', 'sign with entered pass phrase');
    // console.info(`ava.test.timeout.7`);
    await composeFrame.waitAndClick('@action-switch-to-sign', { delay: 0.5 });
    // console.info(`ava.test.timeout.8`);
    await composeFrame.waitAndClick('@action-send');
    // console.info(`ava.test.timeout.9`);
    const passphraseDialog = await settingsPage.getFrame(['passphrase.htm']);
    // console.info(`ava.test.timeout.10`);
    await passphraseDialog.waitAndType('@input-pass-phrase', k.passphrase);
    // console.info(`ava.test.timeout.11`);
    await passphraseDialog.waitAndClick('@action-confirm-pass-phrase-entry'); // confirming pass phrase will send the message
    // console.info(`ava.test.timeout.12`);
    await settingsPage.waitTillGone('@dialog'); // however the @dialog would not go away - so that is a (weak but sufficient) telling sign
    // console.info(`ava.test.timeout.13`);
    // signed - done, now try to see if it remembered pp in session
    const composePage = await ComposePageRecipe.openStandalone(t, browser, 'compose');
    // console.info(`ava.test.timeout.14`);
    await ComposePageRecipe.fillMsg(composePage, 'human@flowcrypt.com', 'signed message pp in session');
    // console.info(`ava.test.timeout.15`);
    await composePage.click('@action-switch-to-sign'); // should remember pass phrase in session from previous entry
    // console.info(`ava.test.timeout.16`);
    await ComposePageRecipe.sendAndClose(composePage);
    // console.info(`ava.test.timeout.17`);
    await settingsPage.close();
    // console.info(`ava.test.timeout.18`);
  }));

  ava.test('compose - standalone - can load contact based on name', testWithNewBrowser(async (t, browser) => {
    await BrowserRecipe.setUpCommonAcct(t, browser, 'compose');
    const composePage = await ComposePageRecipe.openStandalone(t, browser, 'compose');
    await composePage.type('@input-to', 'human'); // test loading of contacts
    await composePage.waitAll(['@container-contacts', '@action-select-contact(human@flowcrypt.com)']);
  }));

  ava.test(`compose - standalone - can choose found contact`, testWithNewBrowser(async (t, browser) => {
    await BrowserRecipe.setUpCommonAcct(t, browser, 'compose');
    const composePage = await ComposePageRecipe.openStandalone(t, browser, 'compose');
    // composePage.enable_debugging('choose-contact');
    await composePage.type('@input-to', 'human'); // test loading of contacts
    await composePage.waitAll(['@container-contacts', '@action-select-contact(human@flowcrypt.com)'], { timeout: 30 });
    await composePage.waitAndClick('@action-select-contact(human@flowcrypt.com)', { retryErrs: true, confirmGone: true, delay: 0 });
    // todo - verify that the contact/pubkey is showing in green once clicked
    await composePage.click('@input-subject');
    await composePage.type('@input-subject', `Automated puppeteer test: pubkey chosen by clicking found contact`);
    await composePage.type('@input-body', `This is an automated puppeteer test: pubkey chosen by clicking found contact`);
    await ComposePageRecipe.sendAndClose(composePage);
  }));

  ava.test(`compose - standalone - freshly loaded pubkey`, testWithNewBrowser(async (t, browser) => {
    await BrowserRecipe.setUpCommonAcct(t, browser, 'compose');
    const composePage = await ComposePageRecipe.openStandalone(t, browser, 'compose');
    await ComposePageRecipe.fillMsg(composePage, 'human@flowcrypt.com', 'freshly loaded pubkey');
    await ComposePageRecipe.sendAndClose(composePage);
  }));

  ava.test('compose - standalone - recipient pasted including name', testWithNewBrowser(async (t, browser) => {
    await BrowserRecipe.setUpCommonAcct(t, browser, 'compose');
    const composePage = await ComposePageRecipe.openStandalone(t, browser, 'compose');
    await ComposePageRecipe.fillMsg(composePage, 'Human at Flowcrypt <Human@FlowCrypt.com>', 'recipient pasted including name');
    await ComposePageRecipe.sendAndClose(composePage);
  }));

  ava.test('compose[global:compose] - standalone - nopgp', testWithSemaphoredGlobalBrowser('compose', async (t, browser) => {
    const composePage = await ComposePageRecipe.openStandalone(t, browser, 'compose');
    await ComposePageRecipe.fillMsg(composePage, 'human+nopgp@flowcrypt.com', 'unknown pubkey');
    await ComposePageRecipe.sendAndClose(composePage, 'test-pass');
  }));

  ava.test('compose[global:compatibility] - standalone - from alias', testWithSemaphoredGlobalBrowser('compatibility', async (t, browser) => {
    const composePage = await ComposePageRecipe.openStandalone(t, browser, 'compatibility');
    await composePage.selectOption('@input-from', 'flowcryptcompatibility@gmail.com');
    await ComposePageRecipe.fillMsg(composePage, 'human@flowcrypt.com', 'from alias');
    await ComposePageRecipe.sendAndClose(composePage);
  }));

  ava.test('compose[global:compose] - standalone - with attachments', testWithSemaphoredGlobalBrowser('compose', async (t, browser) => {
    const composePage = await ComposePageRecipe.openStandalone(t, browser, 'compose');
    await ComposePageRecipe.fillMsg(composePage, 'human@flowcrypt.com', 'with files');
    const fileInput = await composePage.target.$('input[type=file]');
    await fileInput!.uploadFile('test/samples/small.txt', 'test/samples/small.png', 'test/samples/small.pdf');
    await ComposePageRecipe.sendAndClose(composePage);
  }));

  ava.test('compose[global:compose] - standalone - with attachments + nopgp', testWithSemaphoredGlobalBrowser('compose', async (t, browser) => {
    const composePage = await ComposePageRecipe.openStandalone(t, browser, 'compose');
    await ComposePageRecipe.fillMsg(composePage, 'human+nopgp@flowcrypt.com', 'with files + nonppg');
    const fileInput = await composePage.target.$('input[type=file]');
    await fileInput!.uploadFile('test/samples/small.txt', 'test/samples/small.png', 'test/samples/small.pdf');
    await ComposePageRecipe.sendAndClose(composePage, 'test-pass', 90);
  }));

  ava.test('compose[global:compose] - signed message', testWithSemaphoredGlobalBrowser('compose', async (t, browser) => {
    const composePage = await ComposePageRecipe.openStandalone(t, browser, 'compose');
    await ComposePageRecipe.fillMsg(composePage, 'human@flowcrypt.com', 'signed message');
    await composePage.click('@action-switch-to-sign');
    await ComposePageRecipe.sendAndClose(composePage);
  }));

  ava.test('compose[global:compose] - settings - manually copied pubkey', testWithSemaphoredGlobalBrowser('compose', async (t, browser) => {
    let settingsPage = await browser.newPage(t, Url.extensionSettings('test.ci.compose@org.flowcrypt.com'));
    let composeFrame = await ComposePageRecipe.openInSettings(settingsPage);
    await ComposePageRecipe.fillMsg(composeFrame, 'human@flowcrypt.com', 'just to load - will close this page');
    await Util.sleep(1); // todo: should wait until actually loaded
    await settingsPage.close();
    settingsPage = await browser.newPage(t, Url.extensionSettings('test.ci.compose@org.flowcrypt.com'));
    composeFrame = await ComposePageRecipe.openInSettings(settingsPage);
    await ComposePageRecipe.fillMsg(composeFrame, 'human+manualcopypgp@flowcrypt.com', 'manual copied key');
    await composeFrame.waitAndClick('@action-open-add-pubkey-dialog', { delay: 1 });
    await composeFrame.waitAll('@dialog');
    const addPubkeyDialog = await composeFrame.getFrame(['add_pubkey.htm']);
    await addPubkeyDialog.waitAll('@input-select-copy-from');
    await addPubkeyDialog.selectOption('@input-select-copy-from', 'human@flowcrypt.com');
    await addPubkeyDialog.waitAndClick('@action-add-pubkey');
    await composeFrame.waitTillGone('@dialog');
    await composeFrame.waitAndClick('@action-send', { delay: 2 });
    await settingsPage.waitTillGone('@dialog');
  }));

  ava.test('compose[global:compatibility] - reply - old gmail threadId fmt', testWithSemaphoredGlobalBrowser('compatibility', async (t, browser) => {
    const appendUrl = 'isReplyBox=___cu_true___&skipClickPrompt=___cu_false___&ignoreDraft=___cu_false___' +
      '&to=human%40flowcrypt.com&from=flowcrypt.compatibility%40gmail.com&subject=message%20for%20ci%20reply' +
      '&threadId=16841ce0ce5cb74d&threadMsgId=16841ce0ce5cb74d';
    const replyFrame = await ComposePageRecipe.openStandalone(t, browser, 'compatibility', { appendUrl, hasReplyPrompt: true });
    await replyFrame.waitAndClick('@action-accept-reply-prompt', { delay: 1 });
    await replyFrame.waitAndType('@input-body', `This is an automated puppeteer test: old gmail threadId fmt reply`, { delay: 1 });
    await Util.sleep(3); // todo: should wait until actually loaded
    await ComposePageRecipe.sendAndClose(replyFrame);
  }));

  ava.test('compose[global:compatibility] - reply - thread id does not exist', testWithSemaphoredGlobalBrowser('compatibility', async (t, browser) => {
    const appendUrl = 'isReplyBox=___cu_true___&skipClickPrompt=___cu_false___&ignoreDraft=___cu_false___' +
      '&to=human%40flowcrypt.com&from=flowcrypt.compatibility%40gmail.com&subject=Re%3A%20Automated%20puppeteer%20test%3A%20reply' +
      '&threadId=16804894591b3a4b&threadMsgId=16804894591b3a4b';
    const replyFrame = await ComposePageRecipe.openStandalone(t, browser, 'compatibility', { appendUrl, hasReplyPrompt: true });
    await replyFrame.waitAndClick('@action-accept-reply-prompt', { delay: 1 });
    await replyFrame.waitAndType('@input-body', `This is an automated puppeteer test: thread id does not exist reply`, { delay: 1 });
    await Util.sleep(3); // todo: should wait until actually loaded
    await ComposePageRecipe.sendAndClose(replyFrame);
  }));

  ava.test.todo('compose[global:compose] - reply - new gmail threadId fmt');

  ava.test.todo('compose[global:compose] - reply - skip click prompt');

};
