/* ©️ 2016 - present FlowCrypt a.s. Limitations apply. Contact human@flowcrypt.com */

'use strict';

import { Dict, Str, Url, UrlParams } from './core/common.js';
import { Ui } from './browser/ui.js';
import { ApiErr, AjaxErr } from './api/shared/api-error.js';
import { Attachment } from './core/attachment.js';
import { Browser } from './browser/browser.js';
import { Buf } from './core/buf.js';
import { Catch, CompanyLdapKeyMismatchError } from './platform/catch.js';
import { Env } from './browser/env.js';
import { Gmail } from './api/email-provider/gmail/gmail.js';
import { GoogleAuth } from './api/email-provider/gmail/google-auth.js';
import { Lang } from './lang.js';
import { KeyInfoWithIdentityAndOptionalPp, Key, KeyUtil } from './core/crypto/key.js';
import { PgpPwd } from './core/crypto/pgp/pgp-password.js';
import { ClientConfiguration } from './client-configuration.js';
import { Xss } from './platform/xss.js';
import { storageLocalGetAll } from './browser/chrome.js';
import { AccountIndex, AcctStore, SendAsAlias } from './platform/store/acct-store.js';
import { GlobalStore } from './platform/store/global-store.js';
import { AbstractStore } from './platform/store/abstract-store.js';
import { KeyStore } from './platform/store/key-store.js';
import { PassphraseStore } from './platform/store/passphrase-store.js';
import { isCustomerUrlFesUsed } from './helpers.js';
import { Api } from './api/shared/api.js';
import { BrowserMsg } from './browser/browser-msg.js';
import { Time } from './browser/time.js';
import { Google } from './api/email-provider/gmail/google.js';

declare const zxcvbn: Function; // eslint-disable-line @typescript-eslint/ban-types

export class Settings {
  public static evalPasswordStrength = (passphrase: string, type: 'passphrase' | 'pwd' = 'passphrase') => {
    return PgpPwd.estimateStrength(zxcvbn(passphrase, PgpPwd.weakWords()).guesses, type);
  };

  public static renderSubPage = async (
    acctEmail: string | undefined,
    tabId: string,
    page: string,
    addUrlTextOrParams?: string | UrlParams,
    iframeHeight?: number
  ) => {
    await Ui.modal.iframe(Settings.prepareNewSettingsLocationUrl(acctEmail, tabId, page, addUrlTextOrParams), iframeHeight || undefined);
  };

  public static redirectSubPage = (acctEmail: string, parentTabId: string, page: string, addUrlTextOrParams?: string | UrlParams) => {
    window.location.href = Settings.prepareNewSettingsLocationUrl(acctEmail, parentTabId, page, addUrlTextOrParams);
  };

  public static refreshSendAs = async (acctEmail: string) => {
    const fetchedSendAs = await Settings.fetchAcctAliasesFromGmail(acctEmail);
    const result = { defaultEmailChanged: false, aliasesChanged: false, footerChanged: false, sendAs: fetchedSendAs };
    const { sendAs: storedSendAs } = await AcctStore.get(acctEmail, ['sendAs']);
    await AcctStore.set(acctEmail, { sendAs: fetchedSendAs });
    if (!storedSendAs) {
      // Aliases changed (it was previously undefined)
      result.aliasesChanged = true;
      return result;
    }
    if (Settings.getDefaultEmailAlias(fetchedSendAs) !== Settings.getDefaultEmailAlias(storedSendAs)) {
      result.defaultEmailChanged = true;
    }
    if (Object.keys(fetchedSendAs).sort().join(',') !== Object.keys(storedSendAs).sort().join(',')) {
      result.aliasesChanged = true;
    }
    const fetchedFooters = Object.keys(fetchedSendAs)
      .sort()
      .map(email => fetchedSendAs[email].footer)
      .join('|');
    const storedFooters = Object.keys(storedSendAs)
      .sort()
      .map(email => storedSendAs[email].footer)
      .join('|');
    if (fetchedFooters !== storedFooters) {
      result.footerChanged = true;
    }
    return result.aliasesChanged || result.defaultEmailChanged || result.footerChanged ? result : undefined;
  };

  public static acctStorageReset = async (acctEmail: string): Promise<void> => {
    if (!acctEmail) {
      throw new Error('Missing account_email to reset');
    }
    const acctEmails = await GlobalStore.acctEmailsGet();
    if (!acctEmails.includes(acctEmail)) {
      throw new Error(`"${acctEmail}" is not a known account_email in "${JSON.stringify(acctEmails)}"`);
    }
    const storageIndexesToRemove: AccountIndex[] = [];
    const filter = AbstractStore.singleScopeRawIndex(acctEmail, '');
    if (!filter) {
      throw new Error('Filter is empty for account_email"' + acctEmail + '"');
    }
    return await new Promise((resolve, reject) => {
      chrome.storage.local.get(async storage => {
        try {
          for (const storageIndex of Object.keys(storage)) {
            if (storageIndex.indexOf(filter) === 0) {
              storageIndexesToRemove.push(storageIndex.replace(filter, '') as AccountIndex);
            }
          }
          await AcctStore.remove(acctEmail, storageIndexesToRemove);
          for (const sessionStorageIndex of Object.keys(sessionStorage)) {
            if (sessionStorageIndex.indexOf(filter) === 0) {
              sessionStorage.removeItem(sessionStorageIndex);
            }
          }
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
  };

  public static acctStorageChangeEmail = async (oldAcctEmail: string, newAcctEmail: string) => {
    if (!oldAcctEmail || !newAcctEmail || !Str.isEmailValid(newAcctEmail)) {
      throw new Error('Missing or wrong account_email to reset');
    }
    const acctEmails = await GlobalStore.acctEmailsGet();
    if (!acctEmails.includes(oldAcctEmail)) {
      throw new Error(`"${oldAcctEmail}" is not a known account_email in "${JSON.stringify(acctEmails)}"`);
    }
    const oldAcctEmailIndexPrefix = AbstractStore.singleScopeRawIndex(oldAcctEmail, '');
    const newAcctEmailIndexPrefix = AbstractStore.singleScopeRawIndex(newAcctEmail, '');
    if (!oldAcctEmailIndexPrefix) {
      throw new Error(`Filter is empty for account_email "${oldAcctEmail}"`);
    }
    // in case the destination email address was already set up with an account, recover keys and pass phrases before it's overwritten
    const oldAccountPrivateKeys = await KeyStore.get(oldAcctEmail);
    const newAccountPrivateKeys = await KeyStore.get(newAcctEmail);
    const oldAcctPassPhrases: KeyInfoWithIdentityAndOptionalPp[] = [];
    const newAcctPassPhrases: KeyInfoWithIdentityAndOptionalPp[] = [];
    for (const ki of oldAccountPrivateKeys) {
      const passphrase = await PassphraseStore.get(oldAcctEmail, ki, true);
      if (passphrase) {
        oldAcctPassPhrases.push({ ...ki, passphrase });
      }
    }
    for (const ki of newAccountPrivateKeys) {
      const passphrase = await PassphraseStore.get(newAcctEmail, ki, true);
      if (passphrase) {
        newAcctPassPhrases.push({ ...ki, passphrase });
      }
    }
    await GlobalStore.acctEmailsAdd(newAcctEmail);
    const storageIndexesToKeepOld: string[] = [];
    const storageIndexesToKeepNew: string[] = [];
    const storage = await storageLocalGetAll();
    for (const acctKey of Object.keys(storage)) {
      if (acctKey.startsWith(oldAcctEmailIndexPrefix)) {
        const key = acctKey.substr(oldAcctEmailIndexPrefix.length);
        const mode = Settings.getOverwriteMode(key);
        if (mode !== 'forget') {
          storageIndexesToKeepOld.push(key);
        }
      } else if (acctKey.startsWith(newAcctEmailIndexPrefix)) {
        const key = acctKey.substr(newAcctEmailIndexPrefix.length);
        const mode = Settings.getOverwriteMode(key);
        if (mode !== 'keep') {
          storageIndexesToKeepNew.push(key);
        }
      }
    }
    const oldAcctStorage = await AcctStore.get(oldAcctEmail, storageIndexesToKeepOld as unknown as AccountIndex[]);
    const newAcctStorage = await AcctStore.get(newAcctEmail, storageIndexesToKeepNew as unknown as AccountIndex[]);
    await AcctStore.set(newAcctEmail, oldAcctStorage); // save 'fallback' and 'keep' values
    await AcctStore.set(newAcctEmail, newAcctStorage); // save 'forget' and overwrite 'fallback'
    for (const sessionStorageIndex of Object.keys(sessionStorage)) {
      if (sessionStorageIndex.indexOf(oldAcctEmailIndexPrefix) === 0) {
        const v = sessionStorage.getItem(sessionStorageIndex);
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        sessionStorage.setItem(sessionStorageIndex.replace(oldAcctEmailIndexPrefix, newAcctEmailIndexPrefix), v!);
        sessionStorage.removeItem(sessionStorageIndex);
      }
    }
    for (const ki of newAccountPrivateKeys) {
      await KeyStore.add(newAcctEmail, ki.private); // merge kept keys with newAccountPrivateKeys
    }
    const newRules = await ClientConfiguration.newInstance(newAcctEmail);
    if (!newRules.forbidStoringPassPhrase()) {
      for (const ki of oldAcctPassPhrases) {
        await PassphraseStore.set('local', newAcctEmail, ki, ki.passphrase);
      }
      for (const ki of newAcctPassPhrases) {
        await PassphraseStore.set('local', newAcctEmail, ki, ki.passphrase);
      }
    }
    await Settings.acctStorageReset(oldAcctEmail);
    await GlobalStore.acctEmailsRemove(oldAcctEmail);
  };

  public static renderPrvCompatFixUiAndWaitTilSubmittedByUser = async (
    acctEmail: string,
    containerStr: string | JQuery<HTMLElement>,
    origPrv: Key,
    passphrase: string,
    backUrl: string
  ): Promise<Key> => {
    const uids = origPrv.identities;
    if (!uids.length) {
      uids.push(acctEmail);
    }
    const container = $(containerStr as JQuery<HTMLElement>); // due to JQuery TS quirk
    Xss.sanitizeRender(
      container,
      [
        `<div class="line">${Lang.setup.prvHasFixableCompatIssue}</div>`,
        '<div class="line compatibility_fix_user_ids">' + uids.map(uid => '<div>' + Xss.escape(uid) + '</div>').join('') + '</div>',
        '<div class="line">',
        '  Choose expiration of updated key',
        '  <select class="input_fix_expire_years" data-test="input-compatibility-fix-expire-years">',
        '    <option  value="" disabled selected>please choose expiration</option>',
        '    <option value="never">no expiration</option>',
        '    <option value="1">1 year</option>',
        '    <option value="2">2 years</option>',
        '    <option value="3">3 years</option>',
        '    <option value="5">5 years</option>',
        '  </select>',
        '</div>',
        '<div class="line">FlowCrypt will attempt to update the key before importing.</div>',
        '<div class="line">',
        '  <button class="button long gray action_fix_compatibility" data-test="action-fix-and-import-key">UPDATE AND IMPORT KEY</button>',
        '</div>',
      ].join('\n')
    );
    container.find('select.input_fix_expire_years').change(
      Ui.event.handle(target => {
        if ($(target).val()) {
          (container as JQuery<HTMLElement>).find('.action_fix_compatibility').removeClass('gray').addClass('green');
        } else {
          (container as JQuery<HTMLElement>).find('.action_fix_compatibility').removeClass('green').addClass('gray');
        }
      })
    );
    return await new Promise((resolve, reject) => {
      container.find('.action_fix_compatibility').on(
        'click',
        Ui.event.handle(async target => {
          const expireYears = String(
            $(target)
              .parents(container as any) // eslint-disable-line @typescript-eslint/no-explicit-any
              .find('select.input_fix_expire_years')
              .val()
          ); // JQuery quirk
          if (!expireYears) {
            await Ui.modal.warning('Please select key expiration');
          } else {
            $(target).off();
            Xss.sanitizeRender(target, Ui.spinner('white'));
            const expireSeconds = expireYears === 'never' ? 0 : Math.floor((Date.now() - origPrv.created) / 1000) + 60 * 60 * 24 * 365 * Number(expireYears);
            await KeyUtil.decrypt(origPrv, passphrase);
            let reformatted;
            const userIds = uids.map(uid => Str.parseEmail(uid)).map(u => ({ email: u.email, name: u.name || '' }));
            try {
              reformatted = await KeyUtil.reformatKey(origPrv, passphrase, userIds, expireSeconds);
            } catch (e) {
              reject(e);
              return;
            }
            if (!reformatted.fullyEncrypted) {
              // this is a security precaution, in case OpenPGP.js library changes in the future
              Catch.report(`Key update: Key not fully encrypted after update`, {
                isFullyEncrypted: reformatted.fullyEncrypted,
                isFullyDecrypted: reformatted.fullyDecrypted,
              });
              await Ui.modal.error(
                'Key update:Key not fully encrypted after update. ' + Lang.general.contactForSupportSentence(await isCustomerUrlFesUsed(acctEmail))
              );
              Xss.sanitizeReplace(target, Ui.e('a', { href: backUrl, text: 'Go back and try something else' }));
              return;
            }
            if (reformatted.usableForEncryption) {
              resolve(reformatted);
            } else {
              await Ui.modal.error(
                'Key update: Key still cannot be used for encryption. This looks like a compatibility issue.\n\n' +
                  Lang.general.contactForSupportSentence(await isCustomerUrlFesUsed(acctEmail))
              );
              Xss.sanitizeReplace(target, Ui.e('a', { href: backUrl, text: 'Go back and try something else' }));
            }
          }
        })
      );
    });
  };

  public static retryUntilSuccessful = async (action: () => Promise<void>, errTitle: string, contactSentence: string) => {
    try {
      await action();
    } catch (e) {
      return await Settings.promptToRetry(e, errTitle, action, contactSentence);
    }
  };

  /**
   * todo - could probably replace most usages of this method with retryPromptUntilSuccessful which is more intuitive
   */
  public static promptToRetry = async (lastErr: unknown, userMsg: string, retryCb: () => Promise<void>, contactSentence: string): Promise<void> => {
    let errorMsg!: string;
    if (lastErr instanceof AjaxErr && (lastErr.status === 400 || lastErr.status === 405)) {
      // this will make reason for err 400 obvious to user - eg on EKM 405 error
      errorMsg = lastErr.resMsg ?? '';
    } else if (lastErr instanceof CompanyLdapKeyMismatchError) {
      errorMsg = lastErr.message;
    } else {
      errorMsg = ApiErr.eli5(lastErr);
    }
    const userErrMsg = `${userMsg}, ${errorMsg}`;
    while ((await Ui.renderOverlayPromptAwaitUserChoice({ retry: {} }, userErrMsg, ApiErr.detailsAsHtmlWithNewlines(lastErr), contactSentence)) === 'retry') {
      try {
        return await retryCb();
      } catch (e2) {
        lastErr = e2;
        if (ApiErr.isSignificant(e2)) {
          Catch.reportErr(e2);
        }
      }
    }
    // pressing retry button causes to get stuck in while loop until success, at which point it returns, or until user closes tab
    // if it got down here, user has chosen 'skip'. This option is only available on 'OPTIONAL' type
    // if the error happens again, op will be skipped
    return await retryCb();
  };

  public static forbidAndRefreshPageIfCannot = async (action: 'CREATE_KEYS' | 'BACKUP_KEYS', clientConfiguration: ClientConfiguration) => {
    if (action === 'CREATE_KEYS' && !clientConfiguration.canCreateKeys()) {
      await Ui.modal.error(Lang.setup.creatingKeysNotAllowedPleaseImport);
      window.location.reload();
      throw new Error('creating_keys_not_allowed_please_import');
    } else if (action === 'BACKUP_KEYS' && !clientConfiguration.canBackupKeys()) {
      await Ui.modal.error(Lang.setup.keyBackupsNotAllowed);
      window.location.reload();
      throw new Error('key_backups_not_allowed');
    }
  };

  public static newGoogleAcctAuthPromptThenAlertOrForward = async (settingsTabId: string | undefined, acctEmail?: string, scopes?: string[]) => {
    try {
      const response = await GoogleAuth.newAuthPopup({ acctEmail, scopes });
      if (response.result === 'Success' && response.acctEmail) {
        await GlobalStore.acctEmailsAdd(response.acctEmail);
        const storage = await AcctStore.get(response.acctEmail, ['setup_done']);
        if (storage.setup_done) {
          // this was just an additional permission
          await Ui.modal.info("You're all set.");
          window.location.href = Url.create('/chrome/settings/index.htm', { acctEmail: response.acctEmail });
        } else {
          await AcctStore.set(response.acctEmail, { email_provider: 'gmail' }); // eslint-disable-line @typescript-eslint/naming-convention
          window.location.href = Url.create('/chrome/settings/setup.htm', {
            acctEmail: response.acctEmail,
            idToken: response.id_token,
          });
        }
      } else if (response.result === 'Denied' || response.result === 'Closed') {
        const authDeniedHtml = (await Api.ajax({ url: '/chrome/settings/modules/auth_denied.htm' }, Catch.stackTrace())) as string;
        await Ui.modal.info(`${authDeniedHtml}\n<div class="line">${Lang.general.contactIfNeedAssistance()}</div>`, true);
      } else {
        // Do not report error for csrf
        if (response.error !== 'Wrong oauth CSRF token. Please try again.' && !response.error?.includes('Missing client configuration flags')) {
          Catch.report('failed to log into google in newGoogleAcctAuthPromptThenAlertOrForward', response);
        }
        await Ui.modal.error(
          `Failed to connect to Gmail(new). ${Lang.general.contactIfHappensAgain(acctEmail ? await isCustomerUrlFesUsed(acctEmail) : false)}\n\n[${
            response.result
          }] ${response.error}`
        );
        await Time.sleep(1000);
        window.location.reload();
      }
    } catch (e) {
      if (ApiErr.isNetErr(e)) {
        await Ui.modal.error('Could not complete due to network error. Please try again.');
      } else if (ApiErr.isMailOrAcctDisabledOrPolicy(e)) {
        await Ui.modal.error('Your Google account or Gmail service is disabled. Please check your Google account settings.');
      } else {
        Catch.reportErr(e);
        await Ui.modal.error(`Unknown error happened when connecting to Google: ${String(e)}`);
      }
      await Time.sleep(1000);
      window.location.reload();
    }
  };

  public static populateAccountsMenu = async (page: 'index.htm' | 'inbox.htm') => {
    const menuAcctHtml = (email: string, picture = '/img/svgs/profile-icon.svg', isHeaderRow: boolean) => {
      return [
        `<a href="#" ${isHeaderRow && 'id = "header-row"'} class="row alt-accounts action_select_account">`,
        `  <div class="col-2"><img class="profile-img" src="${Xss.escape(picture)}" alt=""></div>`,
        '  <div class="col-10 text-left">',
        `    <div class="contains_email" data-test="action-switch-to-account">${Xss.escape(email)}</div>`,
        '  </div>',
        '</a>',
      ].join('');
    };
    const acctEmails = await GlobalStore.acctEmailsGet();
    const acctStorages = await AcctStore.getAccounts(acctEmails, ['picture', 'setup_done']);
    for (const email of acctEmails) {
      Xss.sanitizePrepend('#alt-accounts', menuAcctHtml(email, acctStorages[email].picture, page === 'inbox.htm'));
    }
    $('#alt-accounts img.profile-img').on(
      'error',
      Ui.event.handle(self => {
        $(self).off().attr('src', '/img/svgs/profile-icon.svg');
      })
    );
    $('.action_select_account').on(
      'click',
      Ui.event.handle((target, event) => {
        event.preventDefault();
        const acctEmail = $(target).find('.contains_email').text();
        const acctStorage = acctStorages[acctEmail];
        window.location.href = acctStorage.setup_done
          ? Url.create(page, { acctEmail })
          : Url.create(Env.getBaseUrl() + '/chrome/settings/index.htm', { acctEmail });
      })
    );
  };

  public static offerToLoginWithPopupShowModalOnErr = (acctEmail: string, then: () => void = () => undefined, prepend = '') => {
    (async () => {
      if (await Ui.modal.confirm(`${prepend}Please log in with FlowCrypt to continue.`)) {
        await Settings.loginWithPopupShowModalOnErr(acctEmail, then);
      }
    })().catch(Catch.reportErr);
  };

  public static loginWithPopupShowModalOnErr = async (acctEmail: string, then: () => void = () => undefined) => {
    if (window !== window.top && !chrome.windows) {
      // Firefox, chrome.windows isn't available in iframes
      Browser.openExtensionTab(Url.create(chrome.runtime.getURL(`chrome/settings/index.htm`), { acctEmail }));
      await Ui.modal.info(`Reload after logging in.`);
      return window.location.reload();
    }
    const authRes = await BrowserMsg.send.bg.await.reconnectAcctAuthPopup({ acctEmail });
    if (authRes.result === 'Success' && authRes.acctEmail && authRes.id_token) {
      then();
    } else {
      await Ui.modal.warning(`Could not log in:\n${authRes.error || authRes.result}`);
    }
  };

  public static resetAccount = async (acctEmail: string): Promise<boolean> => {
    const clientConfiguration = await ClientConfiguration.newInstance(acctEmail);
    if (clientConfiguration.usesKeyManager()) {
      if (await Ui.modal.confirm(Lang.setup.confirmResetAcctForEkm)) {
        await Settings.acctStorageReset(acctEmail);
        return true;
      }
      return false;
    } else {
      if (await Ui.modal.confirm(Lang.setup.confirmResetAcct(acctEmail))) {
        await Settings.collectInfoAndDownloadBackupFile(acctEmail);
        if (await Ui.modal.confirm("Proceed to reset? Don't come back telling me I didn't warn you.")) {
          await Settings.acctStorageReset(acctEmail);
          return true;
        }
      }
      return false;
    }
  };

  public static collectInfoAndDownloadBackupFile = async (acctEmail: string) => {
    const name = `FlowCrypt_BACKUP_FILE_${acctEmail.replace(/[^a-z0-9]+/, '')}.txt`;
    const backupText = await Settings.collectInfoForAccountBackup(acctEmail);
    Browser.saveToDownloads(new Attachment({ name, type: 'text/plain', data: Buf.fromUtfStr(backupText) }));
    await Ui.delay(1000);
  };

  /**
   * determines how to treat old values when changing account
   */
  private static getOverwriteMode = (key: string): 'fallback' | 'forget' | 'keep' => {
    if (key.startsWith('google_token_') || ['rules', 'openid', 'full_name', 'picture', 'sendAs'].includes(key)) {
      // old value should be used if only a new value is missing
      return 'fallback';
    } else if (key.startsWith('passphrase_')) {
      // force forgetting older values
      return 'forget';
    } else {
      // keep old values if any, 'keys' will later be merged with whatever is in the new account
      return 'keep';
    }
  };

  private static collectInfoForAccountBackup = async (acctEmail: string) => {
    const text = [
      'This file contains sensitive information, please put it in a safe place.',
      '',
      'DO NOT DISPOSE OF THIS FILE UNLESS YOU KNOW WHAT YOU ARE DOING',
      '',
      'NOTE DOWN YOUR PASS PHRASE IN A SAFE PLACE THAT YOU CAN FIND LATER',
      '',
      'If this key was registered on a keyserver (typically they are), you will need this same key (and pass phrase!) to replace it.',
      'In other words, losing this key or pass phrase may cause people to have trouble writing you encrypted emails, even if you use another key (on FlowCrypt or elsewhere) later on!',
      '',
      'acctEmail: ' + acctEmail,
    ];
    const globalStorage = await GlobalStore.get(['version']);
    const acctStorage = await AcctStore.get(acctEmail, ['setup_date', 'full_name']);
    text.push('global_storage: ' + JSON.stringify(globalStorage));
    text.push('account_storage: ' + JSON.stringify(acctStorage));
    text.push('');
    const keyinfos = await KeyStore.get(acctEmail);
    for (const keyinfo of keyinfos) {
      text.push('');
      text.push('key_longid: ' + keyinfo.longid);
      text.push(keyinfo.private);
    }
    text.push('');
    return text.join('\n');
  };

  private static prepareNewSettingsLocationUrl = (
    acctEmail: string | undefined,
    parentTabId: string,
    page: string,
    addUrlTextOrParams?: string | UrlParams
  ): string => {
    const pageParams: UrlParams = { placement: 'settings', parentTabId };
    if (acctEmail) {
      pageParams.acctEmail = acctEmail;
    }
    if (typeof addUrlTextOrParams === 'object' && addUrlTextOrParams) {
      // it's a list of params - add them. It could also be a text - then it will be added the end of url below
      for (const k of Object.keys(addUrlTextOrParams)) {
        pageParams[k] = addUrlTextOrParams[k];
      }
      addUrlTextOrParams = undefined;
    }
    return Url.create(page, pageParams) + (addUrlTextOrParams || '');
  };

  private static getDefaultEmailAlias = (sendAs: Dict<SendAsAlias>) => {
    for (const key of Object.keys(sendAs)) {
      if (sendAs[key] && sendAs[key].isDefault) {
        return key;
      }
    }
    return undefined;
  };

  private static fetchAcctAliasesFromGmail = async (acctEmail: string): Promise<Dict<SendAsAlias>> => {
    const response = await new Gmail(acctEmail).fetchAcctAliases();
    const namesRes = await Google.getNames(acctEmail);
    const validAliases = response.sendAs.filter(alias => alias.isPrimary || alias.verificationStatus === 'accepted');
    const result: Dict<SendAsAlias> = {};
    for (const a of validAliases) {
      const sendAsEmail = a.sendAsEmail.toLowerCase();
      result[sendAsEmail] = {
        name: a.displayName,
        isPrimary: !!a.isPrimary,
        isDefault: a.isDefault,
        footer: a.signature,
      };
      if (sendAsEmail === acctEmail.toLowerCase()) {
        result[sendAsEmail].name = namesRes.names.find(name => name.metadata.primary ?? false)?.displayName;
      }
    }
    return result;
  };
}
