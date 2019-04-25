/* © 2016-2018 FlowCrypt Limited. Limitations apply. Contact human@flowcrypt.com */

'use strict';

import { Store } from '../../js/common/platform/store.js';
import { Value } from '../../js/common/core/common.js';
import { Xss, Ui, KeyImportUi, UserAlert, KeyCanBeFixed, Env } from '../../js/common/browser.js';
import { BrowserMsg, Bm } from '../../js/common/extension.js';
import { Rules } from '../../js/common/rules.js';
import { Lang } from '../../js/common/lang.js';
import { Settings } from '../../js/common/settings.js';
import { Api } from '../../js/common/api/api.js';
import { Pgp, Contact } from '../../js/common/core/pgp.js';
import { Catch } from '../../js/common/platform/catch.js';
import { Google, GoogleAuth } from '../../js/common/api/google.js';

declare const openpgp: typeof OpenPGP;

interface SetupOptions {
  passphrase: string;
  passphrase_save: boolean;
  submit_main: boolean;
  submit_all: boolean;
  setup_simple: boolean;
  key_backup_prompt: number | false;
  recovered?: boolean;
  is_newly_created_key: boolean;
}

Catch.try(async () => {

  const uncheckedUrlParams = Env.urlParams(['acctEmail', 'action', 'parentTabId']);
  const acctEmail = Env.urlParamRequire.string(uncheckedUrlParams, 'acctEmail');
  let parentTabId: string | undefined;
  const action = Env.urlParamRequire.oneof(uncheckedUrlParams, 'action', ['add_key', 'finalize', undefined]) as 'add_key' | 'finalize' | undefined;
  if (action === 'add_key') {
    parentTabId = Env.urlParamRequire.string(uncheckedUrlParams, 'parentTabId');
  }

  if (acctEmail) {
    BrowserMsg.send.bg.updateUninstallUrl();
  } else {
    window.location.href = 'index.htm';
    return;
  }

  await Ui.passphraseToggle(['step_2b_manual_enter_passphrase'], 'hide');
  await Ui.passphraseToggle(['step_2a_manual_create_input_password', 'step_2a_manual_create_input_password2', 'recovery_pasword']);

  const storage = await Store.getAcct(acctEmail, ['setup_done', 'key_backup_prompt', 'email_provider', 'google_token_scopes', 'addresses']);

  storage.email_provider = storage.email_provider || 'gmail';
  let acctEmailAttesterFingerprint: string | undefined;
  let recoveredKeys: OpenPGP.key.Key[] = [];
  let recoveredKeysMatchingPassphrases: string[] = [];
  let nRecoveredKeysLongid = 0;
  let recoveredKeysSuccessfulLongids: string[] = [];
  let allAddrs: string[] = [acctEmail];

  const rules = await Rules.newInstance(acctEmail);
  if (!rules.canCreateKeys()) {
    const forbidden = `${Lang.setup.creatingKeysNotAllowedPleaseImport} <a href="${Xss.escape(window.location.href)}">Back</a>`;
    Xss.sanitizeRender('#step_2a_manual_create, #step_2_easy_generating', `<div class="aligncenter"><div class="line">${forbidden}</div></div>`);
    $('.back').remove(); // back button would allow users to choose other options (eg create - not allowed)
  }

  const keyImportUi = new KeyImportUi({ checkEncryption: true });
  keyImportUi.initPrvImportSrcForm(acctEmail, parentTabId); // for step_2b_manual_enter, if user chooses so
  keyImportUi.onBadPassphrase = () => $('#step_2b_manual_enter .input_passphrase').val('').focus();

  const tabId = await BrowserMsg.requiredTabId();
  BrowserMsg.addListener('close_page', async () => {
    $('.featherlight-close').click();
  });
  BrowserMsg.addListener('notification_show', async ({ notification }: Bm.NotificationShow) => {
    await Ui.modal.info(notification);
  });
  BrowserMsg.listen(tabId);

  const renderInitial = async () => {
    $('h1').text('Set Up FlowCrypt');
    $('.email-address').text(acctEmail);
    $('.back').css('visibility', 'hidden');
    if (storage.email_provider === 'gmail') { // show alternative account addresses in setup form + save them for later
      if (!GoogleAuth.hasReadScope(storage.google_token_scopes || [])) {
        $('.auth_denied_warning').css('display', 'block');
      }
      if (typeof storage.addresses === 'undefined') {
        if (GoogleAuth.hasReadScope(storage.google_token_scopes || [])) {
          Settings.fetchAcctAliasesFromGmail(acctEmail).then(saveAndFillSubmitOption).catch(Catch.reportErr);
        } else { // cannot read emails, don't fetch alternative addresses
          saveAndFillSubmitOption([acctEmail]).catch(Catch.reportErr);
        }
      } else {
        showSubmitAllAddrsOption(storage.addresses || []);
      }
    }
    if (storage.setup_done) {
      if (action !== 'add_key') {
        await renderSetupDone();
      } else {
        await renderAddKeyFromBackup();
      }
    } else if (action === 'finalize') {
      const { tmp_submit_all, tmp_submit_main, key_backup_method } = await Store.getAcct(acctEmail, ['tmp_submit_all', 'tmp_submit_main', 'key_backup_method']);
      if (typeof tmp_submit_all === 'undefined' || typeof tmp_submit_main === 'undefined') {
        $('#content').text(`Setup session expired. To set up FlowCrypt, please click the FlowCrypt icon on top right.`);
        return;
      }
      if (typeof key_backup_method !== 'string') {
        await Ui.modal.error('Backup has not successfully finished, will retry');
        window.location.href = Env.urlCreate('modules/backup.htm', { action: 'setup', acctEmail });
        return;
      }
      await finalizeSetup({ submit_all: tmp_submit_all, submit_main: tmp_submit_main });
      await renderSetupDone();
    } else {
      await renderSetupDialog();
    }
  };

  const showSubmitAllAddrsOption = (addrs: string[]) => {
    if (addrs && addrs.length > 1) {
      $('.addresses').text(Value.arr.withoutVal(addrs, acctEmail).join(', '));
      $('.manual .input_submit_all').prop({ checked: true, disabled: false }).closest('div.line').css('display', 'block');
    }
  };

  const saveAndFillSubmitOption = async (addresses: string[]) => {
    allAddrs = Value.arr.unique(addresses.concat(acctEmail));
    await Store.setAcct(acctEmail, { addresses: allAddrs });
    showSubmitAllAddrsOption(allAddrs);
  };

  const displayBlock = (name: string) => {
    const blocks = [
      'loading',
      'step_0_found_key',
      'step_1_easy_or_manual',
      'step_2a_manual_create', 'step_2b_manual_enter', 'step_2_easy_generating', 'step_2_recovery',
      'step_3_compatibility_fix',
      'step_4_more_to_recover',
      'step_4_done',
      'step_4_close',
    ];
    if (name) {
      $('#' + blocks.join(', #')).css('display', 'none');
      $('#' + name).css('display', 'block');
      $('.back').css('visibility', Value.is(name).in(['step_2b_manual_enter', 'step_2a_manual_create']) ? 'visible' : 'hidden');
      if (name === 'step_2_recovery') {
        $('.backups_count_words').text(recoveredKeys.length > 1 ? recoveredKeys.length + ' backups' : 'a backup');
      }
    }
  };

  const renderSetupDialog = async (): Promise<void> => {
    let keyserverRes, fetchedKeys;
    try {
      keyserverRes = await Api.attester.lookupEmail(acctEmail);
    } catch (e) {
      return await Settings.promptToRetry('REQUIRED', e, Lang.setup.failedToCheckIfAcctUsesEncryption, () => renderSetupDialog());
    }
    if (keyserverRes.pubkey) {
      acctEmailAttesterFingerprint = await Pgp.key.fingerprint(keyserverRes.pubkey);
      if (!rules.canBackupKeys()) {
        // they already have a key recorded on attester, but no backups allowed on the domain. They should enter their prv manually
        displayBlock('step_2b_manual_enter');
      } else if (storage.email_provider === 'gmail' && GoogleAuth.hasReadScope(storage.google_token_scopes || [])) {
        try {
          fetchedKeys = await Google.gmail.fetchKeyBackups(acctEmail);
        } catch (e) {
          return await Settings.promptToRetry('REQUIRED', e, Lang.setup.failedToCheckAccountBackups, () => renderSetupDialog());
        }
        if (fetchedKeys.length) {
          recoveredKeys = fetchedKeys;
          nRecoveredKeysLongid = Value.arr.unique(await Promise.all(recoveredKeys.map(Pgp.key.longid))).length;
          displayBlock('step_2_recovery');
        } else {
          displayBlock('step_0_found_key');
        }
      } else { // cannot read gmail to find a backup, or this is outlook
        if (keyserverRes.has_cryptup) {
          // a key has been created, and the user has used cryptup in the past - this suggest they likely have a backup available, but we cannot fetch it. Enter it manually
          displayBlock('step_2b_manual_enter');
          Xss.sanitizePrepend('#step_2b_manual_enter', `<div class="line red">${Lang.setup.cannotLocateBackupPasteManually}<br/><br/></div>`);
        } else if (rules.canCreateKeys()) {
          // has a key registered, key creating allowed on the domain. This may be old key from PKS, let them choose
          displayBlock('step_1_easy_or_manual');
        } else {
          // has a key registered, no key creating allowed on the domain
          displayBlock('step_2b_manual_enter');
        }
      }
    } else { // no indication that the person used pgp before
      if (rules.canCreateKeys()) {
        displayBlock('step_1_easy_or_manual');
      } else {
        displayBlock('step_2b_manual_enter');
      }
    }
  };

  const renderAddKeyFromBackup = async () => { // at this point, account is already set up, and this page is showing in a lightbox after selecting "from backup" in add_key.htm
    let fetchedKeys;
    $('.profile-row, .skip_recover_remaining, .action_send, .action_account_settings, .action_skip_recovery').css({ display: 'none', visibility: 'hidden', opacity: 0 });
    Xss.sanitizeRender($('h1').parent(), '<h1>Recover key from backup</h1>');
    $('.action_recover_account').text('load key from backup');
    try {
      fetchedKeys = await Google.gmail.fetchKeyBackups(acctEmail);
    } catch (e) {
      window.location.href = Env.urlCreate('modules/add_key.htm', { acctEmail, parentTabId });
      return;
    }
    if (fetchedKeys.length) {
      recoveredKeys = fetchedKeys;
      nRecoveredKeysLongid = Value.arr.unique(await Promise.all(recoveredKeys.map(Pgp.key.longid))).length;
      const storedKeys = await Store.keysGet(acctEmail);
      recoveredKeysSuccessfulLongids = storedKeys.map(ki => ki.longid);
      await renderSetupDone();
      $('#step_4_more_to_recover .action_recover_remaining').click();
    } else {
      window.location.href = Env.urlCreate('modules/add_key.htm', { acctEmail, parentTabId });
    }
  };

  const submitPublicKeyIfNeeded = async (armoredPubkey: string, options: { submit_main: boolean, submit_all: boolean }) => {
    const storage = await Store.getAcct(acctEmail, ['addresses']);
    if (!options.submit_main) {
      return;
    }
    Api.attester.testWelcome(acctEmail, armoredPubkey).catch(e => {
      if (Api.err.isSignificant(e)) {
        Catch.report('Api.attester.test_welcome: failed', e);
      }
    });
    let addresses;
    if (typeof storage.addresses !== 'undefined' && storage.addresses.length > 1 && options.submit_all) {
      addresses = storage.addresses.concat(acctEmail);
    } else {
      addresses = [acctEmail];
    }
    if (acctEmailAttesterFingerprint && acctEmailAttesterFingerprint !== await Pgp.key.fingerprint(armoredPubkey)) {
      // already submitted another pubkey for this email
      // todo - offer user to fix it up
      return;
    }
    await Settings.submitPubkeys(acctEmail, addresses, armoredPubkey);
  };

  const renderSetupDone = async () => {
    const storedKeys = await Store.keysGet(acctEmail);
    if (nRecoveredKeysLongid > storedKeys.length) { // recovery where not all keys were processed: some may have other pass phrase
      displayBlock('step_4_more_to_recover');
      $('h1').text('More keys to recover');
      $('.email').text(acctEmail);
      $('.private_key_count').text(storedKeys.length);
      $('.backups_count').text(recoveredKeys.length);
    } else { // successful and complete setup
      displayBlock(action !== 'add_key' ? 'step_4_done' : 'step_4_close');
      $('h1').text(action !== 'add_key' ? 'You\'re all set!' : 'Recovered all keys!');
      $('.email').text(acctEmail);
    }
  };

  const preFinalizeSetup = async (options: SetupOptions): Promise<void> => {
    await Store.setAcct(acctEmail, {
      tmp_submit_main: options.submit_main,
      tmp_submit_all: options.submit_all,
      setup_simple: options.setup_simple,
      key_backup_prompt: options.key_backup_prompt,
      is_newly_created_key: options.is_newly_created_key,
    });
  };

  const finalizeSetup = async ({ submit_main, submit_all }: { submit_main: boolean, submit_all: boolean }): Promise<void> => {
    const [primaryKi] = await Store.keysGet(acctEmail, ['primary']);
    Ui.abortAndRenderErrorIfKeyinfoEmpty(primaryKi);
    try {
      await submitPublicKeyIfNeeded(primaryKi.public, { submit_main, submit_all });
    } catch (e) {
      return await Settings.promptToRetry('REQUIRED', e, Lang.setup.failedToSubmitToAttester, () => finalizeSetup({ submit_main, submit_all }));
    }
    await Store.setAcct(acctEmail, { setup_date: Date.now(), setup_done: true, cryptup_enabled: true });
    await Store.remove(acctEmail, ['tmp_submit_main', 'tmp_submit_all']);
  };

  const saveKeys = async (prvs: OpenPGP.key.Key[], options: SetupOptions) => {
    for (const prv of prvs) {
      const longid = await Pgp.key.longid(prv);
      if (!longid) {
        await Ui.modal.error('Cannot save keys to storage because at least one of them is not valid.');
        return;
      }
      await Store.keysAdd(acctEmail, prv.armor());
      await Store.passphraseSave(options.passphrase_save ? 'local' : 'session', acctEmail, longid, options.passphrase);
    }
    const myOwnEmailAddrsAsContacts: Contact[] = [];
    const { full_name } = await Store.getAcct(acctEmail, ['full_name']);
    for (const addr of allAddrs) {
      myOwnEmailAddrsAsContacts.push(await Store.dbContactObj(addr, full_name, 'cryptup', prvs[0].toPublic().armor(), false, Date.now()));
    }
    await Store.dbContactSave(undefined, myOwnEmailAddrsAsContacts);
  };

  const createSaveKeyPair = async (options: SetupOptions) => {
    await Settings.forbidAndRefreshPageIfCannot('CREATE_KEYS', rules);
    const { full_name } = await Store.getAcct(acctEmail, ['full_name']);
    try {
      const key = await Pgp.key.create([{ name: full_name || '', email: acctEmail }], 4096, options.passphrase); // todo - add all addresses?
      options.is_newly_created_key = true;
      const { keys: [prv] } = await openpgp.key.readArmored(key.private);
      await saveKeys([prv], options);
    } catch (e) {
      Catch.reportErr(e);
      Xss.sanitizeRender('#step_2_easy_generating, #step_2a_manual_create', Lang.setup.fcDidntSetUpProperly);
    }
  };

  $('.action_show_help').click(Ui.event.handle(() => Settings.renderSubPage(acctEmail, tabId, '/chrome/settings/modules/help.htm')));

  $('.back').off().click(Ui.event.handle(() => {
    $('h1').text('Set Up');
    displayBlock('step_1_easy_or_manual');
  }));

  $('#step_2_recovery .action_recover_account').click(Ui.event.prevent('double', async (self) => {
    const passphrase = String($('#recovery_pasword').val());
    const newlyMatchingKeys: OpenPGP.key.Key[] = [];
    if (passphrase && Value.is(passphrase).in(recoveredKeysMatchingPassphrases)) {
      await Ui.modal.warning(Lang.setup.tryDifferentPassPhraseForRemainingBackups);
      return;
    }
    if (!passphrase) {
      await Ui.modal.warning('Please enter the pass phrase you used when you first set up FlowCrypt, so that we can recover your original keys.');
      return;
    }
    let matchedPreviouslyRecoveredKey = false;
    for (const recoveredKey of recoveredKeys) {
      const longid = await Pgp.key.longid(recoveredKey);
      const armored = recoveredKey.armor();
      if (longid) {
        if (Value.is(longid).in(recoveredKeysSuccessfulLongids)) {
          matchedPreviouslyRecoveredKey = true;
        } else if (await Pgp.key.decrypt(recoveredKey, [passphrase]) === true) {
          recoveredKeysSuccessfulLongids.push(longid);
          const { keys: [prv] } = await openpgp.key.readArmored(armored);
          newlyMatchingKeys.push(prv);
        }
      }
    }
    if (!newlyMatchingKeys.length) {
      $('.line_skip_recovery').css('display', 'block');
      if (matchedPreviouslyRecoveredKey) {
        $('#recovery_pasword').val('');
        await Ui.modal.warning('This is a correct pass phrase, but it matches a key that was already recovered. Please try another pass phrase.');
      } else if (recoveredKeys.length > 1) {
        await Ui.modal.warning(`This pass phrase did not match any of your ${recoveredKeys.length} backups. Please try again.`);
      } else {
        await Ui.modal.warning('This pass phrase did not match your original setup. Please try again.');
      }
      return;
    }
    const options: SetupOptions = {
      submit_main: false, // todo - reevaluate submitting when recovering
      submit_all: false,
      passphrase,
      passphrase_save: true, // todo - reevaluate saving passphrase when recovering
      key_backup_prompt: false,
      recovered: true,
      setup_simple: true,
      is_newly_created_key: false,
    };
    recoveredKeysMatchingPassphrases.push(passphrase);
    await saveKeys(newlyMatchingKeys, options);
    const storage = await Store.getAcct(acctEmail, ['setup_done']);
    if (!storage.setup_done) { // normal situation - fresh setup
      await preFinalizeSetup(options);
      await finalizeSetup(options);
      await renderSetupDone();
    } else { // setup was finished before, just added more keys now
      await renderSetupDone();
    }
  }));

  $('#step_4_more_to_recover .action_recover_remaining').click(Ui.event.handle(async () => {
    displayBlock('step_2_recovery');
    $('#recovery_pasword').val('');
    const storedKeys = await Store.keysGet(acctEmail);
    const nGot = storedKeys.length;
    const nBups = recoveredKeys.length;
    const txtTeft = (nBups - nGot > 1) ? 'are ' + (nBups - nGot) + ' backups' : 'is one backup';
    if (action !== 'add_key') {
      Xss.sanitizeRender('#step_2_recovery .recovery_status', Lang.setup.nBackupsAlreadyRecoveredOrLeft(nGot, nBups, txtTeft));
      Xss.sanitizeReplace('#step_2_recovery .line_skip_recovery', Ui.e('div', { class: 'line', html: Ui.e('a', { href: '#', class: 'skip_recover_remaining', html: 'Skip this step' }) }));
      $('#step_2_recovery .skip_recover_remaining').click(Ui.event.handle(() => {
        window.location.href = Env.urlCreate('index.htm', { acctEmail });
      }));
    } else {
      Xss.sanitizeRender('#step_2_recovery .recovery_status', `There ${txtTeft} left to recover.<br><br>Try different pass phrases to unlock all backups.`);
      $('#step_2_recovery .line_skip_recovery').css('display', 'none');
    }
  }));

  $('.action_skip_recovery').click(Ui.event.handle(async target => {
    if (await Ui.modal.confirm(Lang.setup.confirmSkipRecovery)) {
      recoveredKeys = [];
      recoveredKeysMatchingPassphrases = [];
      nRecoveredKeysLongid = 0;
      recoveredKeysSuccessfulLongids = [];
      displayBlock('step_1_easy_or_manual');
    }
  }));

  $('.action_send').click(Ui.event.handle(() => {
    window.location.href = Env.urlCreate('index.htm', { acctEmail, page: '/chrome/elements/compose.htm' });
  }));

  $('.action_account_settings').click(Ui.event.handle(() => {
    window.location.href = Env.urlCreate('index.htm', { acctEmail });
  }));

  $('.action_go_auth_denied').click(Ui.event.handle(() => {
    window.location.href = Env.urlCreate('index.htm', { acctEmail, page: '/chrome/settings/modules/auth_denied.htm' });
  }));

  $('.input_submit_key').click(Ui.event.handle(target => {
    const inputSubmitAll = $(target).closest('.manual').find('.input_submit_all').first();
    if ($(target).prop('checked')) {
      if (inputSubmitAll.closest('div.line').css('visibility') === 'visible') {
        inputSubmitAll.prop({ checked: true, disabled: false });
      }
    } else {
      inputSubmitAll.prop({ checked: false, disabled: true });
    }
  }));

  $('#step_0_found_key .action_manual_create_key, #step_1_easy_or_manual .action_manual_create_key').click(Ui.event.handle(() => displayBlock('step_2a_manual_create')));

  $('#step_0_found_key .action_manual_enter_key, #step_1_easy_or_manual .action_manual_enter_key').click(Ui.event.handle(() => displayBlock('step_2b_manual_enter')));

  $('#step_2b_manual_enter .action_save_private').click(Ui.event.handle(async () => {
    const options: SetupOptions = {
      passphrase: String($('#step_2b_manual_enter .input_passphrase').val()),
      key_backup_prompt: false,
      submit_main: Boolean($('#step_2b_manual_enter .input_submit_key').prop('checked')),
      submit_all: Boolean($('#step_2b_manual_enter .input_submit_all').prop('checked')),
      passphrase_save: Boolean($('#step_2b_manual_enter .input_passphrase_save').prop('checked')),
      is_newly_created_key: false,
      recovered: false,
      setup_simple: false,
    };
    try {
      const checked = await keyImportUi.checkPrv(acctEmail, String($('#step_2b_manual_enter .input_private_key').val()), options.passphrase);
      Xss.sanitizeRender('#step_2b_manual_enter .action_save_private', Ui.spinner('white'));
      await saveKeys([checked.encrypted], options);
      await preFinalizeSetup(options);
      await finalizeSetup(options);
      await renderSetupDone();
    } catch (e) {
      if (e instanceof UserAlert) {
        return await Ui.modal.warning(e.message);
      } else if (e instanceof KeyCanBeFixed) {
        return await renderCompatibilityFixBlockAndFinalizeSetup(e.encrypted, options);
      } else {
        Catch.reportErr(e);
        return await Ui.modal.error(`An error happened when processing the key: ${String(e)}\nPlease write at human@flowcrypt.com`);
      }
    }
  }));

  const renderCompatibilityFixBlockAndFinalizeSetup = async (origPrv: OpenPGP.key.Key, options: SetupOptions) => {
    displayBlock('step_3_compatibility_fix');
    let fixedPrv;
    try {
      fixedPrv = await Settings.renderPrvCompatFixUiAndWaitTilSubmittedByUser(acctEmail, '#step_3_compatibility_fix', origPrv, options.passphrase, window.location.href.replace(/#$/, ''));
    } catch (e) {
      Catch.reportErr(e);
      await Ui.modal.error(`Failed to fix key (${String(e)}). Please write us at human@flowcrypt.com, we are very prompt to fix similar issues.`);
      displayBlock('step_2b_manual_enter');
      return;
    }
    await saveKeys([fixedPrv], options);
    await preFinalizeSetup(options);
    await finalizeSetup(options);
    await renderSetupDone();
  };

  $('#step_2a_manual_create .input_password').on('keyup', Ui.event.prevent('spree', () => {
    Settings.renderPwdStrength('#step_2a_manual_create', '.input_password', '.action_create_private');
  }));

  const isCreatePrivateFormInputCorrect = async () => {
    if (!$('#step_2a_manual_create .input_password').val()) {
      await Ui.modal.warning('Pass phrase is needed to protect your private email. Please enter a pass phrase.');
      $('#step_2a_manual_create .input_password').focus();
      return false;
    }
    if ($('#step_2a_manual_create .action_create_private').hasClass('gray')) {
      await Ui.modal.warning('Pass phrase is not strong enough. Please make it stronger, by adding a few words.');
      $('#step_2a_manual_create .input_password').focus();
      return false;
    }
    if ($('#step_2a_manual_create .input_password').val() !== $('#step_2a_manual_create .input_password2').val()) {
      await Ui.modal.warning('The pass phrases do not match. Please try again.');
      $('#step_2a_manual_create .input_password2').val('');
      $('#step_2a_manual_create .input_password2').focus();
      return false;
    }
    return true;
  };

  $('#step_2a_manual_create .action_create_private').click(Ui.event.prevent('double', async () => {
    await Settings.forbidAndRefreshPageIfCannot('CREATE_KEYS', rules);
    if (! await isCreatePrivateFormInputCorrect()) {
      return;
    }
    try {
      $('#step_2a_manual_create input').prop('disabled', true);
      Xss.sanitizeRender('#step_2a_manual_create .action_create_private', Ui.spinner('white') + 'just a minute');
      const options: SetupOptions = {
        passphrase: String($('#step_2a_manual_create .input_password').val()),
        passphrase_save: Boolean($('#step_2a_manual_create .input_passphrase_save').prop('checked')),
        submit_main: Boolean($('#step_2a_manual_create .input_submit_key').prop('checked')),
        submit_all: Boolean($('#step_2a_manual_create .input_submit_all').prop('checked')),
        key_backup_prompt: rules.canBackupKeys() ? Date.now() : false,
        recovered: false,
        setup_simple: Boolean($('#step_2a_manual_create .input_backup_inbox').prop('checked')),
        is_newly_created_key: true,
      };
      await createSaveKeyPair(options);
      await preFinalizeSetup(options);
      // only finalize after backup is done. backup.htm will redirect back to this page with ?action=finalize
      window.location.href = Env.urlCreate('modules/backup.htm', { action: 'setup', acctEmail });
    } catch (e) {
      Catch.reportErr(e);
      await Ui.modal.error(`There was an error, please try again.\n\n(${String(e)})`);
      $('#step_2a_manual_create .action_create_private').text('CREATE AND SAVE');
    }
  }));

  $('#step_2a_manual_create .action_show_advanced_create_settings').click(Ui.event.handle(target => {
    const advancedCreateSettings = $('#step_2a_manual_create .advanced_create_settings');
    const container = $('#step_2a_manual_create .advanced_create_settings_container');
    if (advancedCreateSettings.is(':visible')) {
      advancedCreateSettings.hide('fast');
      $(target).find('span').text('Show Advanced Settings');
      container.css('width', '360px');
    } else {
      advancedCreateSettings.show('fast');
      $(target).find('span').text('Hide Advanced Settings');
      container.css('width', 'auto');
    }
  }));

  $('#step_4_close .action_close').click(Ui.event.handle(() => { // only rendered if action=add_key which means parentTabId was used
    if (parentTabId) {
      BrowserMsg.send.redirect(parentTabId, { location: Env.urlCreate('index.htm', { acctEmail, advanced: true }) });
    } else {
      Catch.report('setup.ts missing parentTabId');
    }
  }));

  await renderInitial();

})();
