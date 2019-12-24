import * as ava from 'ava';
import * as request from 'fc-node-requests';

import { BrowserHandle, Controllable, ControllablePage } from '../../browser';
import { Config, Util } from '../../util';
import { TestWithGlobalBrowser, TestWithNewBrowser } from '../../test';

import { AvaContext } from '..';
import { BrowserRecipe } from '../browser_recipe';
import { ComposePageRecipe } from '../page_recipe/compose-page-recipe';
import { Dict } from '../../core/common';
import { GoogleData } from '../../mock/google/google-data';
import { InboxPageRecipe } from '../page_recipe/inbox-page-recipe';
import { OauthPageRecipe } from '../page_recipe/oauth-page-recipe';
import { PageRecipe } from '../page_recipe/abstract-page-recipe';
import { PgpHash } from '../../core/pgp-hash';
import { PgpMsg } from '../../core/pgp-msg';
import { SettingsPageRecipe } from '../page_recipe/settings-page-recipe';
import { TestUrls } from './../../browser/test_urls';
import { TestVariant } from '../../util';
import { expect } from "chai";
// tslint:disable:no-blank-lines-func

export const defineComposeTests = (testVariant: TestVariant, testWithNewBrowser: TestWithNewBrowser, testWithSemaphoredGlobalBrowser: TestWithGlobalBrowser) => {

  if (testVariant !== 'CONSUMER-LIVE-GMAIL') {

    ava.default('compose[global:compatibility] - toggle minimized state by clicking compose window header', testWithSemaphoredGlobalBrowser('compatibility', async (t, browser) => {
      const inboxPage = await browser.newPage(t, TestUrls.extensionInbox('flowcrypt.compatibility@gmail.com'));
      const composeFrame = await InboxPageRecipe.openAndGetComposeFrame(inboxPage);
      const initialComposeFrameHeight = await inboxPage.getOuterHeight('iframe');
      await composeFrame.waitAll('#section_header');
      const composeFrameHeaderHeight = await composeFrame.getOuterHeight('#section_header');
      // mimimize compose frame
      await composeFrame.waitAndClick('@header-title');
      expect(await inboxPage.getOuterHeight('iframe')).to.eq(composeFrameHeaderHeight);
      // restore compose frame
      await composeFrame.waitAndClick('@header-title');
      expect(await inboxPage.getOuterHeight('iframe')).to.eq(initialComposeFrameHeight);
    }));

    ava.default('[standalone] compose - signed with entered pass phrase + will remember pass phrase in session', testWithNewBrowser(async (t, browser) => {
      const k = Config.key('test.ci.compose');
      await BrowserRecipe.setUpCommonAcct(t, browser, 'compose');
      const settingsPage = await browser.newPage(t, TestUrls.extensionSettings('test.ci.compose@org.flowcrypt.com'));
      await SettingsPageRecipe.forgetAllPassPhrasesInStorage(settingsPage, k.passphrase);
      const inboxPage = await browser.newPage(t, TestUrls.extensionInbox('test.ci.compose@org.flowcrypt.com'));
      const composeFrame = await InboxPageRecipe.openAndGetComposeFrame(inboxPage);
      await ComposePageRecipe.fillMsg(composeFrame, { to: 'human@flowcrypt.com' }, 'sign with entered pass phrase', { encrypt: false });
      await composeFrame.waitAndClick('@action-send');
      await inboxPage.waitAll('@dialog-passphrase');
      const passphraseDialog = await inboxPage.getFrame(['passphrase.htm']);
      await passphraseDialog.waitAndType('@input-pass-phrase', k.passphrase);
      await passphraseDialog.waitAndClick('@action-confirm-pass-phrase-entry');
      await inboxPage.waitTillGone('@dialog-passphrase');
      await inboxPage.waitTillGone('@container-new-message'); // confirming pass phrase will auto-send the message
      // signed - done, now try to see if it remembered pp in session
      const composePage = await ComposePageRecipe.openStandalone(t, browser, 'compose');
      await ComposePageRecipe.fillMsg(composePage, { to: 'human@flowcrypt.com' }, 'signed message pp in session', { encrypt: false });
      await ComposePageRecipe.sendAndClose(composePage);
      await settingsPage.close();
      await inboxPage.close();
    }));

    ava.default('[standalone] compose - can load contact based on name', testWithNewBrowser(async (t, browser) => {
      await BrowserRecipe.setUpCommonAcct(t, browser, 'compose');
      const composePage = await ComposePageRecipe.openStandalone(t, browser, 'compose');
      await composePage.type('@input-to', 'human'); // test loading of contacts
      await composePage.waitAll(['@container-contacts', '@action-select-contact(human@flowcrypt.com)']);
    }));

    ava.default(`[standalone] compose - can choose found contact`, testWithNewBrowser(async (t, browser) => {
      await BrowserRecipe.setUpCommonAcct(t, browser, 'compose');
      const composePage = await ComposePageRecipe.openStandalone(t, browser, 'compose');
      // composePage.enable_debugging('choose-contact');
      await composePage.type('@input-to', 'human'); // test loading of contacts
      await composePage.waitAll(['@container-contacts', '@action-select-contact(human@flowcrypt.com)'], { timeout: 30 });
      await composePage.waitAndClick('@action-select-contact(human@flowcrypt.com)', { retryErrs: true, confirmGone: true, delay: 0 });
      // todo - verify that the contact/pubkey is showing in green once clicked
      await composePage.waitAndClick('@input-subject');
      await composePage.type('@input-subject', `Automated puppeteer test: pubkey chosen by clicking found contact`);
      await composePage.type('@input-body', `This is an automated puppeteer test: pubkey chosen by clicking found contact`);
      await ComposePageRecipe.sendAndClose(composePage);
    }));

    ava.default(`[standalone] compose - freshly loaded pubkey`, testWithNewBrowser(async (t, browser) => {
      await BrowserRecipe.setUpCommonAcct(t, browser, 'compose');
      const composePage = await ComposePageRecipe.openStandalone(t, browser, 'compose');
      await ComposePageRecipe.fillMsg(composePage, { to: 'human@flowcrypt.com' }, 'freshly loaded pubkey');
      await ComposePageRecipe.sendAndClose(composePage);
    }));

    ava.default('[standalone] compose - recipient pasted including name', testWithNewBrowser(async (t, browser) => {
      await BrowserRecipe.setUpCommonAcct(t, browser, 'compose');
      const composePage = await ComposePageRecipe.openStandalone(t, browser, 'compose');
      await ComposePageRecipe.fillMsg(composePage, { to: 'Human at Flowcrypt <Human@FlowCrypt.com>' }, 'recipient pasted including name');
      await ComposePageRecipe.sendAndClose(composePage);
    }));

    ava.default('compose[global:compose] - standalone - nopgp', testWithSemaphoredGlobalBrowser('compose', async (t, browser) => {
      const composePage = await ComposePageRecipe.openStandalone(t, browser, 'compose');
      await ComposePageRecipe.fillMsg(composePage, { to: 'human+nopgp@flowcrypt.com' }, 'unknown pubkey');
      await ComposePageRecipe.sendAndClose(composePage, { password: 'test-pass' });
    }));

    ava.default('compose[global:compatibility] - standalone - from alias', testWithSemaphoredGlobalBrowser('compatibility', async (t, browser) => {
      const composePage = await ComposePageRecipe.openStandalone(t, browser, 'compatibility');
      await composePage.selectOption('@input-from', 'flowcryptcompatibility@gmail.com');
      await ComposePageRecipe.fillMsg(composePage, { to: 'human@flowcrypt.com' }, 'from alias');
      await ComposePageRecipe.sendAndClose(composePage);
    }));

    ava.default('compose[global:compatibility] - standalone - with attachments + shows progress %', testWithSemaphoredGlobalBrowser('compatibility', async (t, browser) => {
      const composePage = await ComposePageRecipe.openStandalone(t, browser, 'compatibility');
      await ComposePageRecipe.fillMsg(composePage, { to: 'human@flowcrypt.com' }, 'with files');
      const fileInput = await composePage.target.$('input[type=file]');
      await fileInput!.uploadFile('test/samples/small.txt', 'test/samples/small.png', 'test/samples/small.pdf', 'test/samples/large.jpg');
      await ComposePageRecipe.sendAndClose(composePage, { expectProgress: true });
    }));

    ava.default('compose[global:compose] - standalone - with attachments + nopgp', testWithSemaphoredGlobalBrowser('compose', async (t, browser) => {
      const composePage = await ComposePageRecipe.openStandalone(t, browser, 'compose');
      await ComposePageRecipe.fillMsg(composePage, { to: 'human+nopgp@flowcrypt.com' }, 'with files + nonppg');
      const fileInput = await composePage.target.$('input[type=file]');
      await fileInput!.uploadFile('test/samples/small.txt', 'test/samples/small.png', 'test/samples/small.pdf');
      await ComposePageRecipe.sendAndClose(composePage, { password: 'test-pass', timeout: 90 });
    }));

    ava.default('compose[global:compose] - signed message', testWithSemaphoredGlobalBrowser('compose', async (t, browser) => {
      const composePage = await ComposePageRecipe.openStandalone(t, browser, 'compose');
      await ComposePageRecipe.fillMsg(composePage, { to: 'human@flowcrypt.com' }, 'signed message', { encrypt: false });
      await ComposePageRecipe.sendAndClose(composePage);
    }));

    ava.default('compose[global:compose] - settings - manually copied pubkey', testWithNewBrowser(async (t, browser) => {
      await BrowserRecipe.setUpCommonAcct(t, browser, 'compose');
      const inboxPage = await browser.newPage(t, TestUrls.extensionInbox('test.ci.compose@org.flowcrypt.com'));
      let composeFrame = await InboxPageRecipe.openAndGetComposeFrame(inboxPage);
      await ComposePageRecipe.fillMsg(composeFrame, { to: 'human@flowcrypt.com' }, 'just to load - will close this page');
      await Util.sleep(2); // todo: should wait until actually loaded
      await composeFrame.waitAndClick('@action-close-new-message');
      await inboxPage.waitTillGone('@container-new-message');
      composeFrame = await InboxPageRecipe.openAndGetComposeFrame(inboxPage);
      await ComposePageRecipe.fillMsg(composeFrame, { to: 'human+manualcopypgp@flowcrypt.com' }, 'manual copied key');
      await composeFrame.waitAndClick('@action-open-add-pubkey-dialog', { delay: 1 });
      await inboxPage.waitAll('@dialog-add-pubkey');
      const addPubkeyDialog = await inboxPage.getFrame(['add_pubkey.htm']);
      await addPubkeyDialog.waitAll('@input-select-copy-from');
      await Util.sleep(1);
      await addPubkeyDialog.selectOption('@input-select-copy-from', 'human@flowcrypt.com');
      await Util.sleep(1);
      await addPubkeyDialog.waitAndClick('@action-add-pubkey');
      await inboxPage.waitTillGone('@dialog-add-pubkey');
      await composeFrame.waitAndClick('@action-send', { delay: 2 });
      await inboxPage.waitTillGone('@container-new-message');
    }));

    ava.default('compose[global:compatibility] - reply - old gmail threadId fmt', testWithSemaphoredGlobalBrowser('compatibility', async (t, browser) => {
      const appendUrl = 'skipClickPrompt=___cu_false___&ignoreDraft=___cu_false___&threadId=16841ce0ce5cb74d&replyMsgId=16841ce0ce5cb74d';
      const replyFrame = await ComposePageRecipe.openStandalone(t, browser, 'compatibility', { appendUrl, skipValidation: true });
      await replyFrame.waitAll(['#new_message', '@action-retry-by-reloading']);
      expect(await replyFrame.read('#new_message')).to.include('Cannot get reply data for the message you are replying to');
      await replyFrame.notPresent('@action-accept-reply-prompt');
    }));

    ava.default('compose[global:compatibility] - reply - thread id does not exist', testWithSemaphoredGlobalBrowser('compatibility', async (t, browser) => {
      const appendUrl = 'skipClickPrompt=___cu_false___&ignoreDraft=___cu_false___&threadId=16804894591b3a4b&replyMsgId=16804894591b3a4b';
      const replyFrame = await ComposePageRecipe.openStandalone(t, browser, 'compatibility', { appendUrl, skipValidation: true, });
      await replyFrame.waitAll(['#new_message', '@action-retry-by-reloading']);
      expect(await replyFrame.read('#new_message')).to.include('Cannot get reply data for the message you are replying to');
      await replyFrame.notPresent('@action-accept-reply-prompt');
    }));

    ava.default('compose[global:compose] - standalone - quote - can load quote from encrypted/text email', testWithSemaphoredGlobalBrowser('compatibility', async (t, browser) => {
      const appendUrl = 'threadId=16b584ed95837510&skipClickPrompt=___cu_false___&ignoreDraft=___cu_false___&replyMsgId=16b584ed95837510';
      const composePage = await ComposePageRecipe.openStandalone(t, browser, 'compatibility', { appendUrl, hasReplyPrompt: true });
      await composePage.waitAndClick('@action-accept-reply-prompt', { delay: 5 });
      await baseQuotingTest(composePage, [
        'On 2019-06-14 at 23:24, flowcrypt.compatibility@gmail.com wrote:',
        '> This is some message',
        '>',
        '> and below is the quote',
        '>',
        '> > this is the quote',
        '> > still the quote',
        '> > third line',
        '> >> double quote',
        '> >> again double quote'
      ].join('\n'));
      await ComposePageRecipe.sendAndClose(composePage);
    }));

    ava.default('compose[global:compatibility] - standalone - quote - can load quote from plain/text email', testWithSemaphoredGlobalBrowser('compatibility', async (t, browser) => {
      const appendUrl = 'threadId=16402d6dc4342e7f&skipClickPrompt=___cu_false___&ignoreDraft=___cu_false___' +
        '&replyMsgId=16402d6dc4342e7f';
      const composePage = await ComposePageRecipe.openStandalone(t, browser, 'compatibility', { appendUrl, hasReplyPrompt: true });
      await composePage.waitAndClick('@action-accept-reply-prompt', { delay: 1 });
      await baseQuotingTest(composePage, [
        'On 2018-06-15 at 09:46, info@nvimp.com wrote:',
        '> cropping all except for the image below'
      ].join('\n'));
    }));

    ava.default('compose[global:compatibility] - reply - can load quote from plain/html email', testWithSemaphoredGlobalBrowser('compatibility', async (t, browser) => {
      const appendUrl = 'threadId=16b36861a890bb26&skipClickPrompt=___cu_false___' +
        '&ignoreDraft=___cu_false___&replyMsgId=16b36861a890bb26';
      const composePage = await ComposePageRecipe.openStandalone(t, browser, 'compatibility', { appendUrl, hasReplyPrompt: true });
      await composePage.waitAndClick('@action-accept-reply-prompt', { delay: 1 });
      expect(await composePage.read('@input-body')).to.not.include('The best footer ever!');
      await baseQuotingTest(composePage, [
        'On 2019-06-08 at 09:57, human@flowcrypt.com wrote:',
        '> Used to fail on Android app',
        '>',
        '> ---------- Forwarded message ---------',
        '> From: Mozilla <Mozilla@e.mozilla.org>',
        '> Date: Thu, 6 Jun 2019, 17:22',
        '> Subject: Your misinformation questions ... answered.',
        '> To: <tom@cryptup.org>'
      ].join('\n'));
    }));

    ava.default('compose[global:compatibility] - reply - can load quote from encrypted/html email', testWithSemaphoredGlobalBrowser('compatibility', async (t, browser) => {
      const appendUrl = 'threadId=1663a65bbd73ce1a&skipClickPrompt=___cu_false___&ignoreDraft=___cu_false___&replyMsgId=1663a65bbd73ce1a';
      const composePage = await ComposePageRecipe.openStandalone(t, browser, 'compatibility', { appendUrl, hasReplyPrompt: true });
      await composePage.waitAndClick('@action-accept-reply-prompt', { delay: 1 });
      await baseQuotingTest(composePage, [
        'On 2018-10-03 at 14:47, henry.electrum@gmail.com wrote:',
        '> The following text is bold: this is bold',
        '>',
        '> The following text is red: this text is red'
      ].join('\n'));
    }));

    ava.default('compose[global:compatibility] - reply - pass phrase dialog - dialog ok', testWithNewBrowser(async (t, browser) => {
      const pp = Config.key('flowcrypt.compatibility.1pp1').passphrase;
      await BrowserRecipe.setUpCommonAcct(t, browser, 'compatibility');
      const { inboxPage, replyFrame } = await setRequirePassPhraseAndOpenRepliedMessage(t, browser, pp);
      // Get Passphrase dialog and write confirm passphrase
      await inboxPage.waitAll('@dialog-passphrase');
      const passPhraseFrame = await inboxPage.getFrame(['passphrase.htm']);
      await passPhraseFrame.waitAndType('@input-pass-phrase', pp);
      await passPhraseFrame.waitAndClick('@action-confirm-pass-phrase-entry');
      await inboxPage.waitTillGone('@dialog');
      // Then we can try to run base test
      await baseQuotingTest(replyFrame, [
        'On 2019-06-14 at 23:24, flowcrypt.compatibility@gmail.com wrote:',
        '> This is some message',
        '>',
        '> and below is the quote',
        '>',
        '> > this is the quote',
        '> > still the quote',
        '> > third line',
        '> >> double quote',
        '> >> again double quote'
      ].join('\n'));
    }));

    ava.default('compose[global:compatibility] - reply - pass phrase dialog - dialog cancel', testWithNewBrowser(async (t, browser) => {
      const pp = Config.key('flowcrypt.compatibility.1pp1').passphrase;
      await BrowserRecipe.setUpCommonAcct(t, browser, 'compatibility');
      const { inboxPage, replyFrame } = await setRequirePassPhraseAndOpenRepliedMessage(t, browser, pp);
      // Get Passphrase dialog and cancel confirm passphrase
      await inboxPage.waitAll('@dialog-passphrase');
      const passPhraseFrame = await inboxPage.getFrame(['passphrase.htm']);
      await passPhraseFrame.waitAndClick('@action-cancel-pass-phrase-entry');
      await inboxPage.waitTillGone('@dialog');
      await replyFrame.waitAll(['@action-expand-quoted-text']);
      const inputBody = await replyFrame.read('@input-body');
      // tslint:disable: no-unused-expression
      expect(inputBody.trim()).to.be.empty;
      await baseQuotingTest(replyFrame, [
        'On 2019-06-14 at 23:24, flowcrypt.compatibility@gmail.com wrote:',
        '> (Skipping previous message quote)'
      ].join('\n'));
    }));

    ava.default('compose[global:compatibility] - reply - signed message', testWithSemaphoredGlobalBrowser('compatibility', async (t, browser) => {
      const appendUrl = 'threadId=15f7f5face7101db&skipClickPrompt=___cu_false___&ignoreDraft=___cu_false___&replyMsgId=15f7f5face7101db';
      const composePage = await ComposePageRecipe.openStandalone(t, browser, 'compatibility', { appendUrl, hasReplyPrompt: true });
      await composePage.waitAndClick('@action-accept-reply-prompt', { delay: 1 });
      await composePage.waitAll('@action-send');
      await Util.sleep(0.5);
      expect(await composePage.read('@action-send')).to.eq('Sign and Send');
      await composePage.waitAndClick('@action-show-options-popover');
      await composePage.waitAll(['@action-toggle-sign', '@action-toggle-encrypt', '@icon-toggle-sign-tick']);
      await composePage.notPresent(['@icon-toggle-encrypt-tick']); // response to signed message should not be auto-encrypted
      await ComposePageRecipe.fillMsg(composePage, {}, undefined, {}, 'reply');
      await ComposePageRecipe.sendAndClose(composePage);
    }));

    ava.default('compose[global:compatibility] - forward - pgp/mime signed-only', testWithSemaphoredGlobalBrowser('compatibility', async (t, browser) => {
      const appendUrl = 'threadId=15f7fc2919788f03&skipClickPrompt=___cu_false___&ignoreDraft=___cu_false___&replyMsgId=15f7fc2919788f03';
      const composePage = await ComposePageRecipe.openStandalone(t, browser, 'compatibility', { appendUrl, hasReplyPrompt: true });
      await composePage.waitAndClick('@action-forward');
      await ComposePageRecipe.fillRecipients(composePage, { to: 'human@flowcrypt.com' }, 'reply');
      expect(await composePage.read('@input-body')).to.include('> This message will contain a separately attached file + signature.');
      await composePage.waitAny('.qq-file-id-0');
    }));

    ava.default('compose[global:compose] - standalone- hide/show btns after signing', testWithSemaphoredGlobalBrowser('compose', async (t, browser) => {
      const composePage = await ComposePageRecipe.openStandalone(t, browser, 'compose');
      await ComposePageRecipe.fillMsg(composePage, { to: 'test.no.pgp@test.com' }, 'Signed Message', { encrypt: false });
      expect(await composePage.isElementPresent('@add-intro')).to.be.true;
      expect(await composePage.isElementPresent('@password-or-pubkey-container')).to.be.true;
      await composePage.notPresent('@add-intro');
      await composePage.notPresent('@password-or-pubkey-container');
    }));

    ava.default('compose[global:compose] - standalone - CC&BCC new message', testWithSemaphoredGlobalBrowser('compose', async (t, browser) => {
      const composePage = await ComposePageRecipe.openStandalone(t, browser, 'compose');
      await ComposePageRecipe.fillMsg(composePage, { to: 'human@flowcrypt.com', cc: 'human@flowcrypt.com', bcc: 'human@flowcrypt.com' }, 'Testing CC And BCC');
      await ComposePageRecipe.sendAndClose(composePage);
    }));

    ava.default('compose[global:compatibility] - reply - CC&BCC test reply', testWithSemaphoredGlobalBrowser('compatibility', async (t, browser) => {
      const appendUrl = 'threadId=16ce2c965c75e5a6&skipClickPrompt=___cu_false___&ignoreDraft=___cu_false___&replyMsgId=16ce2c965c75e5a6';
      const composePage = await ComposePageRecipe.openStandalone(t, browser, 'compatibility', { appendUrl, hasReplyPrompt: true });
      await composePage.waitAndClick('@action-accept-reply-all-prompt', { delay: 2 });
      await ComposePageRecipe.fillMsg(composePage, { bcc: "test@email.com" }, undefined, undefined, 'reply');
      await expectRecipientElements(composePage, { to: ['censored@email.com'], cc: ['censored@email.com'], bcc: ['test@email.com'] });
      await Util.sleep(3);
      await ComposePageRecipe.sendAndClose(composePage, { password: 'test-pass' });
    }));

    ava.default('compose[global:compatibility] - reply - CC&BCC test forward', testWithSemaphoredGlobalBrowser('compatibility', async (t, browser) => {
      const appendUrl = 'threadId=16ce2c965c75e5a6&skipClickPrompt=___cu_false___&ignoreDraft=___cu_false___&replyMsgId=16ce2c965c75e5a6';
      const composePage = await ComposePageRecipe.openStandalone(t, browser, 'compatibility', { appendUrl, hasReplyPrompt: true });
      await composePage.waitAndClick('@action-forward', { delay: 2 });
      await composePage.waitAny('@input-to'); // if this element is present then the elemenent should be focused
      await expectRecipientElements(composePage, { to: [], cc: [], bcc: [] });
    }));

    ava.default('compose[global:compose] - standalone - expired can still send', testWithSemaphoredGlobalBrowser('compose', async (t, browser) => {
      const composePage = await ComposePageRecipe.openStandalone(t, browser, 'compose');
      await ComposePageRecipe.fillMsg(composePage, { to: 'expired.on.attester@domain.com' }, 'Test Expired Email');
      const expandContainer = await composePage.waitAny('@action-show-container-cc-bcc-buttons');
      const recipient = await expandContainer.$('.email_preview span');
      expect(await PageRecipe.getElementPropertyJson(recipient!, 'className')).to.include('expired');
      await composePage.waitAndClick('@action-send');
      await PageRecipe.waitForModalAndRespond(composePage, 'confirm', { contentToCheck: 'The public key of one of your recipients is expired.', clickOn: 'confirm', timeout: 40 });
      await composePage.waitForSelTestState('closed', 20); // succesfully sent
      await composePage.close();
    }));

    ava.default('compose[global:comaptibility] - loading drafts - new message, rendering cc/bcc and check if cc/bcc btns are hidden',
      testWithSemaphoredGlobalBrowser('compatibility', async (t, browser) => {
        const appendUrl = 'draftId=draft-1';
        const composePage = await ComposePageRecipe.openStandalone(t, browser, 'compatibility', { appendUrl });
        await expectRecipientElements(composePage, { to: ['flowcryptcompatibility@gmail.com'], cc: ['flowcrypt.compatibility@gmail.com'], bcc: ['human@flowcrypt.com'] });
        const subjectElem = await composePage.waitAny('@input-subject');
        expect(await (await subjectElem.getProperty('value')).jsonValue()).to.equal('Test Draft - New Message');
        expect(await composePage.read('@input-body')).to.equal('Testing Drafts (Do not delete)');
        for (const elem of await composePage.target.$$('.email-copy-actions > span')) {
          expect(await PageRecipe.getElementPropertyJson(elem, 'offsetHeight')).to.equal(0); // CC/BCC btn isn't visible
        }
      }));

    ava.default('compose[global:compatibility] - loading drafts - reply', testWithNewBrowser(async (t, browser) => {
      await BrowserRecipe.setUpCommonAcct(t, browser, 'compatibility');
      const appendUrl = 'threadId=16cfa9001baaac0a&skipClickPrompt=___cu_false___&ignoreDraft=___cu_false___&replyMsgId=16cfa9001baaac0a';
      const initialScript = () => {
        chrome.storage.local.set({ 'cryptup_flowcryptcompatibilitygmailcom_drafts_reply': { '16cfa9001baaac0a': 'draft-3' } });
      };
      const composePage = await ComposePageRecipe.openStandalone(t, browser, 'compatibility', { appendUrl, hasReplyPrompt: true, skipClickPropt: true, initialScript });
      await composePage.waitAndClick('@action-show-container-cc-bcc-buttons');
      await expectRecipientElements(composePage, { to: ['flowcryptcompatibility@gmail.com'] });
      expect(await composePage.read('@input-body')).to.include('Test Draft Reply (Do not delete, tests is using this draft)');
    }));

    ava.default('key-mismatch[global:compatibility] - standalone - key mismatch loading', testWithSemaphoredGlobalBrowser('compatibility', async (t, browser) => {
      const params = 'threadId=15f7f5630573be2d&skipClickPrompt=___cu_true___&ignoreDraft=___cu_true___&replyMsgId=15f7f5630573be2d&disableDraftSaving=___cu_true___&replyPubkeyMismatch=___cu_true___'; // eslint-disable-line max-len
      const replyMismatchPage = await browser.newPage(t, 'chrome/elements/compose.htm?account_email=flowcrypt.compatibility%40gmail.com&parent_tab_id=0&debug=___cu_true___&frameId=none&' + params); // eslint-disable-line max-len
      await replyMismatchPage.waitForSelTestState('ready');
      await Util.sleep(3);
      await expectRecipientElements(replyMismatchPage, { to: ['censored@email.com'], cc: [], bcc: [] });
      expect(await replyMismatchPage.read('@input-body')).to.include('I was not able to read your encrypted message because it was encrypted for a wrong key.');
      await replyMismatchPage.waitAll('.qq-upload-file');
      await ComposePageRecipe.sendAndClose(replyMismatchPage);
    }));

    ava.default('compose[global:compatibility] - reply all - TO/CC/BCC when replying all', testWithSemaphoredGlobalBrowser('compatibility', async (t, browser) => {
      const appendUrl = `threadId=16d6a6c2d6ae618f&skipClickPrompt=___cu_false___&ignoreDraft=___cu_false___&replyMsgId=16d6a6c2d6ae618f`;
      const composePage = await ComposePageRecipe.openStandalone(t, browser, 'compatibility', { appendUrl, hasReplyPrompt: true });
      await composePage.waitAndClick('@action-accept-reply-all-prompt');
      await composePage.waitForSelTestState('ready'); // continue when all recipients get evaluated
      await composePage.waitAndClick('@action-show-container-cc-bcc-buttons');
      for (const type of ['to', 'cc', 'bcc']) {
        const container = (await composePage.waitAny(`@container-${type}`))!;
        const recipients = await container.$$('.recipients > span');
        expect(recipients.length).to.equal(2);
        for (const recipient of recipients) {
          const textContent = await PageRecipe.getElementPropertyJson(recipient, 'textContent');
          expect(textContent.trim()).to.include('@flowcrypt.com');
        }
      }
    }));

    ava.default('compose[global:compose] - standalone - send new plain message', testWithSemaphoredGlobalBrowser('compose', async (t, browser) => {
      const composePage = await ComposePageRecipe.openStandalone(t, browser, 'compose');
      await ComposePageRecipe.fillMsg(composePage, { to: 'human@flowcrypt.com' }, 'New Plain Message', { encrypt: false, sign: false });
      await ComposePageRecipe.sendAndClose(composePage);
    }));

    ava.default('compose[global:compose] - standalone - send btn should be disabled while encrypting/sending', testWithSemaphoredGlobalBrowser('compose', async (t, browser) => {
      const composePage = await ComposePageRecipe.openStandalone(t, browser, 'compose');
      await ComposePageRecipe.fillMsg(composePage, { to: 'human@flowcrypt.com' }, '');
      await composePage.waitAndClick('@action-send', { delay: 1 });
      expect(await composePage.isDisabled('#send_btn')).to.be.true;
      await composePage.waitAndRespondToModal('confirm', 'cancel', 'Send without a subject?');
      expect(await composePage.isDisabled('#send_btn')).to.be.false;
    }));

    ava.default('compose[global:compose] - standalone - load contacts through API', testWithNewBrowser(async (t, browser) => {
      await BrowserRecipe.setUpCommonAcct(t, browser, 'compose');
      let composePage = await ComposePageRecipe.openStandalone(t, browser, 'compose');
      await composePage.waitAndClick('@action-show-container-cc-bcc-buttons');
      // first search, did not yet receive contacts scope
      await composePage.type('@input-to', 'contact');
      await expectFirstContactResultEqual(composePage, 'No Contacts Found');
      // allow contacts scope, and expect that it will find a contact
      const oauthPopup = await browser.newPageTriggeredBy(t, () => composePage.waitAndClick('@action-auth-with-contacts-scope'), 'test.ci.compose@org.flowcrypt.com');
      await OauthPageRecipe.google(t, oauthPopup, 'test.ci.compose@org.flowcrypt.com', 'approve');
      await expectFirstContactResultEqual(composePage, 'contact.test@flowcrypt.com');
      // re-load the compose window, expect that it remembers scope was connected, and remembers the contact
      composePage = await ComposePageRecipe.openStandalone(t, browser, 'compose');
      await composePage.waitAndClick('@action-show-container-cc-bcc-buttons');
      await composePage.type('@input-to', 'contact');
      await expectFirstContactResultEqual(composePage, 'contact.test@flowcrypt.com');
      await composePage.notPresent('@action-auth-with-contacts-scope');
    }));

    ava.default('[compose[global:compatibility] - standalone - different send from, new signed message, verification in mock', testWithNewBrowser(async (t, browser) => {
      await BrowserRecipe.setUpCommonAcct(t, browser, 'compatibility');
      const settingsPage = await browser.newPage(t, '/chrome/settings/modules/add_key.htm?acctEmail=flowcrypt.compatibility%40gmail.com&parent_tab_id=0');
      const key = Config.key('flowcryptcompatibility.from.address');
      await settingsPage.waitAndClick('#source_paste');
      await settingsPage.waitAndType('.input_private_key', key.armored!);
      await settingsPage.waitAndClick('#toggle_input_passphrase');
      await settingsPage.waitAndType('#input_passphrase', key.passphrase!);
      await settingsPage.waitAndClick('.action_add_private_key');
      await settingsPage.waitTillGone('.featherlight.featherlight-iframe'); // dialog closed
      await settingsPage.close();
      const composePage = await ComposePageRecipe.openStandalone(t, browser, 'compatibility');
      await composePage.selectOption('@input-from', 'flowcryptcompatibility@gmail.com');
      await ComposePageRecipe.fillMsg(composePage, { to: 'human@flowcrypt.com' }, 'New Signed Message (Mock Test)', { encrypt: false });
      await ComposePageRecipe.sendAndClose(composePage);
    }));

    ava.default('[compose[global:compatibility]] - standalone - new message, open footer', testWithSemaphoredGlobalBrowser('compatibility', async (t, browser) => {
      const composePage = await ComposePageRecipe.openStandalone(t, browser, 'compatibility');
      await ComposePageRecipe.fillRecipients(composePage, { to: 'human@flowcrypt.com' }, 'new');
      await composePage.waitAndClick(`@action-send`);
      expect(await composePage.read('#swal2-content')).to.include('Send without a subject?');
      await composePage.waitAndClick('.swal2-cancel');
      await composePage.waitAndType('@input-subject', 'Testing new message with footer', { delay: 1 });
      await composePage.waitAndClick(`@action-send`);
      expect(await composePage.read('#swal2-content')).to.include('Send empty message?');
      await composePage.waitAndClick('.swal2-cancel');
      await composePage.waitAndClick('@action-expand-quoted-text', { delay: 1 });
      const footer = await composePage.read('@input-body');
      expect(footer).to.include('The best footer ever!');
      await composePage.waitAndClick(`@action-send`);
      expect(await composePage.read('#swal2-content')).to.include('Send empty message?');
      await composePage.waitAndClick('.swal2-cancel');
      await composePage.waitAndType('@input-body', 'New message\n' + footer, { delay: 1 });
      await ComposePageRecipe.sendAndClose(composePage);
    }));

    ava.default('[compose[global:compatibility]] - standalone - new message, Footer Mock Test', testWithSemaphoredGlobalBrowser('compatibility', async (t, browser) => {
      const composePage = await ComposePageRecipe.openStandalone(t, browser, 'compatibility');
      await ComposePageRecipe.fillMsg(composePage, { to: 'human@flowcrypt.com' }, 'Test Footer (Mock Test)', {}, 'new');
      await ComposePageRecipe.sendAndClose(composePage);
    }));

    ava.default('compose[global:compatibility] - standalone - send pwd encrypted msg & check on flowcrypt site', testWithSemaphoredGlobalBrowser('compatibility', async (t, browser) => {
      const msgPwd = 'super hard password for the message';
      const subject = 'PWD encrypted message with attachment';
      const composePage = await ComposePageRecipe.openStandalone(t, browser, 'compatibility');
      await ComposePageRecipe.fillMsg(composePage, { to: 'test@email.com' }, subject);
      const fileInput = await composePage.target.$('input[type=file]');
      await fileInput!.uploadFile('test/samples/small.txt');
      await ComposePageRecipe.sendAndClose(composePage, { password: msgPwd });
      const msg = new GoogleData('flowcrypt.compatibility@gmail.com').getMessageBySubject(subject)!;
      const webDecryptUrl = msg.payload.body!.data!.match(/https:\/\/flowcrypt.com\/[a-z0-9A-Z]+/g)![0];
      const webDecryptPage = await browser.newPage(t, webDecryptUrl);
      await webDecryptPage.waitAndType('.decrypt_answer', msgPwd);
      await webDecryptPage.waitAndClick('.action_decrypt');
      await webDecryptPage.waitAll('.pgp_block');
      await Util.sleep(0.5); // todo - would be better to find a way to wait until ready
      expect(await webDecryptPage.read('.pgp_block')).to.include(subject);
      expect(await webDecryptPage.read('.pgp_block')).to.include('The best footer ever!'); // test if footer is present
      expect(await webDecryptPage.read('.attachment')).to.include('small.txt.pgp');
      const [attElem] = await webDecryptPage.page.$x('.//@data-test-donwload-url');
      const attUrl = await PageRecipe.getElementPropertyJson(attElem, 'value');
      const res = await request.get({ url: attUrl, encoding: null }); // tslint:disable-line:no-null-keyword
      const decryptedFile = await PgpMsg.decrypt({ encryptedData: res.body as Buffer, kisWithPp: [], msgPwd: await PgpHash.challengeAnswer(msgPwd) });
      expect(decryptedFile.content!.toUtfStr()).to.equal(`small text file\nnot much here\nthis worked\n`);
    }));

    ava.default('compose[global:compatibility] - loading drafts - test tags in draft', testWithSemaphoredGlobalBrowser('compatibility', async (t, browser) => {
      const appendUrl = 'draftId=draft-0';
      const composePage = await ComposePageRecipe.openStandalone(t, browser, 'compatibility', { appendUrl });
      expect(await composePage.read('@input-body')).to.include('hello<draft>here');
    }));

    ava.default('compose[global:compose] - test minimizing/maximizing', testWithSemaphoredGlobalBrowser('compose', async (t, browser) => {
      const inboxPage = await browser.newPage(t, 'chrome/settings/inbox/inbox.htm?acctEmail=test.ci.compose%40org.flowcrypt.com');
      await inboxPage.waitAndClick('@action-open-secure-compose-window');
      await inboxPage.waitAll(['@container-new-message']);
      const composeFrame = await inboxPage.getFrame(['compose.htm']);
      await composeFrame.waitForSelTestState('ready');
      const composeBody = await composeFrame.waitAny('body');
      const initialWidth = Number(await PageRecipe.getElementPropertyJson(composeBody, 'offsetWidth'));
      const initialHeight = Number(await PageRecipe.getElementPropertyJson(composeBody, 'offsetHeight'));
      await composeFrame.waitAndClick('.popout', { sleepWhenDone: 1 });
      expect(Number(await PageRecipe.getElementPropertyJson(composeBody, 'offsetWidth'))).to.be.greaterThan(initialWidth);
      expect(Number(await PageRecipe.getElementPropertyJson(composeBody, 'offsetHeight'))).to.be.greaterThan(initialHeight);
      await composeFrame.waitAndClick('.popout', { sleepWhenDone: 1 });
      expect(Number(await PageRecipe.getElementPropertyJson(composeBody, 'offsetWidth'))).to.equal(initialWidth);
      expect(Number(await PageRecipe.getElementPropertyJson(composeBody, 'offsetHeight'))).to.equal(initialHeight);
      await composeFrame.waitAndClick('.minimize_new_message', { sleepWhenDone: 1 });
      expect(Number(await PageRecipe.getElementPropertyJson(composeBody, 'offsetHeight'))).to.be.lessThan(initialHeight);
      await composeFrame.waitAndClick('.minimize_new_message', { sleepWhenDone: 1 });
      expect(Number(await PageRecipe.getElementPropertyJson(composeBody, 'offsetHeight'))).to.equal(initialHeight);
    }));

    ava.todo('compose[global:compose] - reply - new gmail threadId fmt');

    ava.todo('compose[global:compose] - reply - skip click prompt');

  }

};

const setRequirePassPhraseAndOpenRepliedMessage = async (t: AvaContext, browser: BrowserHandle, passpharase: string) => {
  const settingsPage = await browser.newPage(t, TestUrls.extensionSettings());
  await SettingsPageRecipe.forgetAllPassPhrasesInStorage(settingsPage, passpharase);
  // Open Message Page
  const inboxPage = await browser.newPage(t, TestUrls.extension(`chrome/settings/inbox/inbox.htm?acctEmail=flowcrypt.compatibility@gmail.com&threadId=16b584ed95837510`));
  await inboxPage.waitAll('iframe');
  // Get Reply Window (Composer) and click on reply button.
  const replyFrame = await inboxPage.getFrame(['compose.htm']);
  await replyFrame.waitAndClick('@action-accept-reply-prompt');

  return { inboxPage, replyFrame };
};

const baseQuotingTest = async (composePage: Controllable, textToInclude: string) => {
  await composePage.waitAll(['@action-expand-quoted-text']);
  await Util.sleep(2); // wait for quote to be loaded and button activated
  expect(await composePage.read('@input-body')).to.not.include(textToInclude);
  await composePage.waitAndClick('@action-expand-quoted-text');
  await composePage.waitTillGone(['@action-expand-quoted-text']);
  expect(await composePage.read('@input-body')).to.include(textToInclude);
};

const expectRecipientElements = async (controllable: ControllablePage, expected: { to?: string[], cc?: string[], bcc?: string[] }) => {
  for (const type of ['to', 'cc', 'bcc']) {
    const expectedEmails: string[] | undefined = (expected as Dict<string[]>)[type] || undefined; // tslint:disable-line:no-unsafe-any
    if (expectedEmails) {
      const container = await controllable.waitAny(`@container-${type}`, { visible: false });
      const recipientElements = await container.$$('.recipients > span');
      expect(recipientElements.length).to.equal(expectedEmails.length);
      for (const recipientElement of recipientElements) {
        const textContent = await (await recipientElement.getProperty('textContent')).jsonValue() as string;
        expect(expectedEmails).to.include(textContent.trim());
      }
    }
  }
};

const expectFirstContactResultEqual = async (composePage: ControllablePage, string: string) => {
  await composePage.waitAny('@container-contacts');
  await Util.sleep(0.5);
  await composePage.waitTillGone('@container-contacts-loading');
  await Util.sleep(0.5);
  const contacts = await composePage.waitAny('@container-contacts');
  expect(await PageRecipe.getElementPropertyJson((await contacts.$('ul li:first-child'))!, 'textContent')).to.eq(string);
};
