/* © 2016-2018 FlowCrypt Limited. Limitations apply. Contact human@flowcrypt.com */

'use strict';

import { VERSION } from '../../js/common/core/const.js';
import { Catch } from '../../js/common/platform/catch.js';
import { Store } from '../../js/common/platform/store.js';
import { Str } from '../../js/common/core/common.js';
import { Ui, Env, JQS, UrlParams } from '../../js/common/browser.js';
import { Rules } from '../../js/common/rules.js';
import { Notifications } from '../../js/common/notifications.js';
import { Settings } from '../../js/common/settings.js';
import { Api } from '../../js/common/api/api.js';
import { BrowserMsg, Bm } from '../../js/common/extension.js';
import { Lang } from '../../js/common/lang.js';
import { Google } from '../../js/common/api/google.js';
import { KeyInfo } from '../../js/common/core/pgp.js';
import { Backend } from '../../js/common/api/backend.js';
import { Assert } from '../../js/common/assert.js';
import { XssSafeFactory } from '../../js/common/xss_safe_factory.js';
import { Xss } from '../../js/common/platform/xss.js';

declare const openpgp: typeof OpenPGP;

Catch.try(async () => {

  const uncheckedUrlParams = Env.urlParams(['acctEmail', 'page', 'pageUrlParams', 'advanced', 'addNewAcct']);
  const acctEmail = Assert.urlParamRequire.optionalString(uncheckedUrlParams, 'acctEmail');
  let page = Assert.urlParamRequire.optionalString(uncheckedUrlParams, 'page');
  page = (page === 'undefined') ? undefined : page; // in case an "undefined" strring slipped in
  const pageUrlParams: UrlParams | undefined = (typeof uncheckedUrlParams.pageUrlParams === 'string') ? JSON.parse(uncheckedUrlParams.pageUrlParams) as UrlParams : undefined;
  const addNewAcct = uncheckedUrlParams.addNewAcct === true;
  const advanced = uncheckedUrlParams.advanced === true;

  $('#status-row #status_v').text(`v:${VERSION}`);

  const rules = await Rules.newInstance(acctEmail);
  if (!rules.canBackupKeys()) {
    $('.show_settings_page[page="modules/backup.htm"]').parent().remove();
    $('.settings-icons-rows').css({ position: 'relative', left: '64px' }); // lost a button - center it again
  }

  for (const webmailLName of await Env.webmails()) {
    $('.signin_button.' + webmailLName).css('display', 'inline-block');
  }

  const tabId = await BrowserMsg.requiredTabId();
  const notifications = new Notifications(tabId);

  BrowserMsg.addListener('open_page', async ({ page, addUrlText }: Bm.OpenPage) => {
    Settings.renderSubPage(acctEmail, tabId, page, addUrlText);
  });
  BrowserMsg.addListener('redirect', async ({ location }: Bm.Redirect) => {
    window.location.href = location;
  });
  BrowserMsg.addListener('close_page', async () => {
    $('.featherlight-close').click();
  });
  BrowserMsg.addListener('reload', async ({ advanced }: Bm.Reload) => {
    $('.featherlight-close').click();
    reload(advanced);
  });
  BrowserMsg.addListener('add_pubkey_dialog', async ({ emails }: Bm.AddPubkeyDialog) => {
    // todo: use #cryptup_dialog just like passphrase_dialog does
    const factory = new XssSafeFactory(acctEmail!, tabId);
    window.open(factory.srcAddPubkeyDialog(emails, 'settings'), '_blank', 'height=680,left=100,menubar=no,status=no,toolbar=no,top=30,width=660');
  });
  BrowserMsg.addListener('subscribe_dialog', async ({ }: Bm.SubscribeDialog) => {
    // todo: use #cryptup_dialog just like passphrase_dialog does
    const factory = new XssSafeFactory(acctEmail!, tabId);
    const subscribeDialogSrc = factory.srcSubscribeDialog(undefined, 'settings_compose', undefined);
    window.open(subscribeDialogSrc, '_blank', 'height=650,left=100,menubar=no,status=no,toolbar=no,top=30,width=640,scrollbars=no');
  });
  BrowserMsg.addListener('notification_show', async ({ notification }: Bm.NotificationShow) => {
    notifications.show(notification);
    let cleared = false;
    const clear = () => {
      if (!cleared) {
        notifications.clear();
        cleared = true;
      }
    };
    Catch.setHandledTimeout(clear, 10000);
    $('.webmail_notifications').one('click', clear);
  });
  BrowserMsg.addListener('open_google_auth_dialog', async ({ acctEmail, scopes }: Bm.OpenGoogleAuthDialog) => {
    $('.featherlight-close').click();
    await Settings.newGoogleAcctAuthPromptThenAlertOrForward(tabId, acctEmail, scopes);
  });
  BrowserMsg.addListener('passphrase_dialog', async ({ longids, type }: Bm.PassphraseDialog) => {
    if (!$('#cryptup_dialog').length) {
      const factory = new XssSafeFactory(acctEmail!, tabId);
      $('body').append(factory.dialogPassphrase(longids, type)); // xss-safe-factory
    }
  });
  BrowserMsg.addListener('notification_show_auth_popup_needed', async ({ acctEmail }: Bm.NotificationShowAuthPopupNeeded) => {
    notifications.showAuthPopupNeeded(acctEmail);
  });
  BrowserMsg.addListener('close_dialog', async () => {
    $('#cryptup_dialog').remove();
  });
  BrowserMsg.listen(tabId);

  const displayOrig = (selector: string) => {
    const filterable = $(selector);
    filterable.filter('a, b, i, img, span, input, label, select').css('display', 'inline-block');
    filterable.filter('table').css('display', 'table');
    filterable.filter('tr').css('display', 'table-row');
    filterable.filter('td').css('display', 'table-cell');
    filterable.not('a, b, i, img, span, input, label, select, table, tr, td').css('display', 'block');
  };

  const initialize = async () => {
    if (addNewAcct) {
      $('.show_if_setup_not_done').css('display', 'initial');
      $('.hide_if_setup_not_done').css('display', 'none');
      await Settings.newGoogleAcctAuthPromptThenAlertOrForward(tabId);
    } else if (acctEmail) {
      $('.email-address').text(acctEmail);
      $('#security_module').attr('src', Env.urlCreate('modules/security.htm', { acctEmail, parentTabId: tabId, embedded: true }));
      const storage = await Store.getAcct(acctEmail, ['setup_done', 'email_provider', 'picture']);
      const scopes = await Store.getScopes(acctEmail);
      if (storage.setup_done) {
        checkGoogleAcct().catch(Catch.reportErr);
        checkFcAcctAndSubscriptionAndContactPage(acctEmail).catch(Catch.reportErr);
        if (storage.picture) {
          $('img.main-profile-img').attr('src', storage.picture).on('error', Ui.event.handle(self => {
            $(self).off().attr('src', '/img/svgs/profile-icon.svg');
          }));
        }
        if (!(scopes.read || scopes.modify) && (storage.email_provider || 'gmail') === 'gmail') {
          $('.auth_denied_warning').css('display', 'block');
        }
        displayOrig('.hide_if_setup_not_done');
        $('.show_if_setup_not_done').css('display', 'none');
        if (advanced) {
          $("#settings").toggleClass("advanced");
        }
        const privateKeys = await Store.keysGet(acctEmail);
        if (privateKeys.length > 4) {
          $('.key_list').css('overflow-y', 'scroll');
        }
        await addKeyRowsHtml(privateKeys);
      } else {
        displayOrig('.show_if_setup_not_done');
        $('.hide_if_setup_not_done').css('display', 'none');
      }
    } else {
      const acctEmails = await Store.acctEmailsGet();
      if (acctEmails && acctEmails[0]) {
        window.location.href = Env.urlCreate('index.htm', { acctEmail: acctEmails[0] });
      } else {
        $('.show_if_setup_not_done').css('display', 'initial');
        $('.hide_if_setup_not_done').css('display', 'none');
      }
    }

    Backend.retrieveBlogPosts().then(posts => { // do not await because may take a while
      for (const post of posts) {
        const html = `<div class="line"><a href="https://flowcrypt.com${Xss.escape(post.url)}" target="_blank">${Xss.escape(post.title.trim())}</a> ${Xss.escape(post.date.trim())}</div>`;
        Xss.sanitizeAppend('.blog_post_list', html);
      }
    }).catch(e => Api.err.isSignificant(e) ? Catch.reportErr(e) : undefined);
  };

  const checkFcAcctAndSubscriptionAndContactPage = async (acctEmail: string) => {
    const statusContainer = $('.public_profile_indicator_container');
    try {
      await renderSubscriptionStatusHeader(acctEmail);
    } catch (e) {
      Catch.reportErr(e);
    }
    const authInfo = await Store.authInfo(acctEmail);
    if (authInfo.uuid) { // have auth email set
      try {
        const response = await Backend.accountUpdate(authInfo);
        $('#status-row #status_flowcrypt').text(`fc:ok`);
        if (response && response.result && response.result.alias) {
          statusContainer.find('.status-indicator-text').css('display', 'none');
          statusContainer.find('.status-indicator').addClass('active');
        } else {
          statusContainer.find('.status-indicator').addClass('inactive');
        }
      } catch (e) {
        if (Api.err.isAuthErr(e)) {
          const actionReauth = Ui.event.handle(() => Settings.offerToLoginWithPopupShowModalOnErr(acctEmail));
          Xss.sanitizeRender(statusContainer, '<a class="bad" href="#">Auth Needed</a>').find('a').click(actionReauth);
          $('#status-row #status_flowcrypt').text(`fc:auth`).addClass('bad').addClass('link').click(actionReauth);
        } else if (Api.err.isNetErr(e)) {
          Xss.sanitizeRender(statusContainer, '<a href="#">Network Error - Retry</a>').find('a').one('click', Ui.event.handle(() => checkFcAcctAndSubscriptionAndContactPage(acctEmail)));
          $('#status-row #status_flowcrypt').text(`fc:offline`);
        } else {
          statusContainer.text('ecp error');
          $('#status-row #status_flowcrypt').text(`fc:error`).attr('title', `FlowCrypt Account Error: ${Xss.escape(String(e))}`);
          Catch.reportErr(e);
        }
      }
    } else { // never set up
      statusContainer.find('.status-indicator').addClass('inactive');
      $('#status-row #status_flowcrypt').text(`fc:none`);
    }
    statusContainer.css('visibility', 'visible');
  };

  const resolveChangedGoogleAcct = async (newAcctEmail: string) => {
    try {
      await Settings.refreshAcctAliases(acctEmail!);
      await Settings.acctStorageChangeEmail(acctEmail!, newAcctEmail);
      await Ui.modal.info(`Email address changed to ${newAcctEmail}. You should now check that your public key is properly submitted.`);
      window.location.href = Env.urlCreate('index.htm', { acctEmail: newAcctEmail, page: '/chrome/settings/modules/keyserver.htm' });
    } catch (e) {
      if (Api.err.isNetErr(e)) {
        await Ui.modal.error('There was a network error, please try again.');
      } else if (Api.err.isMailOrAcctDisabledOrPolicy(e)) {
        await Ui.modal.error(Lang.account.googleAcctDisabledOrPolicy);
      } else if (Api.err.isAuthPopupNeeded(e)) {
        await Ui.modal.warning('New authorization needed. Please try Additional Settings -> Experimental -> Force Google Account email change');
      } else {
        Catch.reportErr(e);
        await Ui.modal.error(`There was an error changing google account, please write human@flowcrypt.com\n\n${Api.err.eli5(e)}\n\n${String(e)}`);
      }
    }
  };

  const checkGoogleAcct = async () => {
    try {
      const { sendAs } = await Google.gmail.fetchAcctAliases(acctEmail!);
      const primary = sendAs.find(addr => addr.isPrimary === true);
      if (!primary) {
        await Ui.modal.warning(`Your account sendAs does not have any primary sendAsEmail`);
        return;
      }
      const googleAcctEmailAddr = primary.sendAsEmail;
      $('#status-row #status_google').text(`g:${googleAcctEmailAddr}:ok`);
      if (googleAcctEmailAddr !== acctEmail) {
        $('#status-row #status_google').text(`g:${googleAcctEmailAddr}:changed`).addClass('bad').attr('title', 'Account email address has changed');
        if (googleAcctEmailAddr && acctEmail) {
          if (await Ui.modal.confirm(`Your Google Account address seems to have changed from ${acctEmail} to ${googleAcctEmailAddr}. FlowCrypt Settings need to be updated accordingly.`)) {
            await resolveChangedGoogleAcct(googleAcctEmailAddr);
          }
        }
      }
    } catch (e) {
      if (Api.err.isAuthPopupNeeded(e)) {
        $('#status-row #status_google').text(`g:?:disconnected`).addClass('bad').attr('title', 'Not connected to Google Account, click to resolve.')
          .off().click(Ui.event.handle(() => Settings.newGoogleAcctAuthPromptThenAlertOrForward(tabId, acctEmail)));
      } else if (Api.err.isAuthErr(e)) {
        $('#status-row #status_google').text(`g:?:auth`).addClass('bad').attr('title', 'Auth error when checking Google Account, click to resolve.')
          .off().click(Ui.event.handle(() => Settings.newGoogleAcctAuthPromptThenAlertOrForward(tabId, acctEmail)));
      } else if (Api.err.isMailOrAcctDisabledOrPolicy(e)) {
        await Ui.modal.error(Lang.account.googleAcctDisabledOrPolicy);
      } else if (Api.err.isNetErr(e)) {
        $('#status-row #status_google').text(`g:?:offline`);
      } else {
        $('#status-row #status_google').text(`g:?:err`).addClass('bad').attr('title', `Cannot determine Google account: ${Xss.escape(String(e))}`);
        Catch.reportErr(e);
      }
    }
  };

  const renderSubscriptionStatusHeader = async (acctEmail: string) => {
    let liveness = '';
    try {
      await Backend.getSubscriptionWithoutLogin(acctEmail);
      liveness = 'live';
    } catch (e) {
      if (!Api.err.isNetErr(e)) {
        Catch.reportErr(e);
        liveness = 'err';
      } else {
        liveness = 'offline';
      }
    }
    const subscription = await Store.subscription(acctEmail);
    $('#status-row #status_subscription').text(`s:${liveness}:${subscription.active ? 'active' : 'inactive'}-${subscription.method}:${subscription.expire}`);
    if (subscription.active) {
      const showAcct = () => Settings.renderSubPage(acctEmail, tabId, '/chrome/settings/modules/account.htm');
      $('.logo-row .subscription .level').text('advanced').css('display', 'inline-block').click(Ui.event.handle(showAcct)).css('cursor', 'pointer');
      if (subscription.method === 'trial') {
        $('.logo-row .subscription .expire').text(subscription.expire ? ('trial ' + subscription.expire.split(' ')[0]) : 'lifetime').css('display', 'inline-block');
        $('.logo-row .subscription .upgrade').css('display', 'inline-block');
      } else if (subscription.method === 'group') {
        $('#status-row #status_google').text(`s:${liveness}:active:group`);
        $('.logo-row .subscription .expire').text('group billing').css('display', 'inline-block');
      }
    } else {
      $('.logo-row .subscription .level').text('free forever').css('display', 'inline-block');
      if (subscription.level && subscription.expire && subscription.method) {
        if (subscription.method === 'trial') {
          $('.logo-row .subscription .expire').text('trial done').css('display', 'inline-block');
        } else if (subscription.method === 'group') {
          $('.logo-row .subscription .expire').text('expired').css('display', 'inline-block');
        }
        $('.logo-row .subscription .upgrade').text('renew');
      }
      $('.logo-row .subscription .upgrade').css('display', 'inline-block');
    }
  };

  const addKeyRowsHtml = async (privateKeys: KeyInfo[]) => {
    let html = '';
    for (let i = 0; i < privateKeys.length; i++) {
      const ki = privateKeys[i];
      const { keys: [prv] } = await openpgp.key.readArmored(ki.private);
      const date = Str.monthName(prv.primaryKey.created.getMonth()) + ' ' + prv.primaryKey.created.getDate() + ', ' + prv.primaryKey.created.getFullYear();
      const escapedPrimaryOrRemove = (ki.primary) ? '(primary)' : '(<a href="#" class="action_remove_key" longid="' + Xss.escape(ki.longid) + '">remove</a>)';
      const escapedEmail = Xss.escape(Str.parseEmail(prv.users[0].userId ? prv.users[0].userId!.userid : '').email || '');
      const escapedLongid = Xss.escape(ki.longid);
      const escapedLink = `<a href="#" data-test="action-show-key-${i}" class="action_show_key" page="modules/my_key.htm" addurltext="&longid=${escapedLongid}">${escapedEmail}</a>`;
      html += `<div class="row key-content-row key_${Xss.escape(ki.longid)}">`;
      html += `  <div class="col-sm-12">${escapedLink} from ${Xss.escape(date)}&nbsp;&nbsp;&nbsp;&nbsp;${escapedPrimaryOrRemove}</div>`;
      html += `  <div class="col-sm-12">KeyWords: <span class="good">${Xss.escape(ki.keywords)}</span></div>`;
      html += `</div>`;
    }
    Xss.sanitizeAppend('.key_list', html);
    $('.action_show_key').click(Ui.event.handle(target => {
      // the UI below only gets rendered when account_email is available
      Settings.renderSubPage(acctEmail!, tabId, $(target).attr('page')!, $(target).attr('addurltext') || ''); // all such elements do have page attr
    }));
    $('.action_remove_key').click(Ui.event.handle(async target => {
      // the UI below only gets rendered when account_email is available
      await Store.keysRemove(acctEmail!, $(target).attr('longid')!);
      await Store.passphraseSave('local', acctEmail!, $(target).attr('longid')!, undefined);
      await Store.passphraseSave('session', acctEmail!, $(target).attr('longid')!, undefined);
      reload(true);
    }));
  };

  $.get('/changelog.txt', data => ($('#status-row #status_v') as any as JQS).featherlight(String(data).replace(/\n/g, '<br>')), 'html');

  $('.show_settings_page').click(Ui.event.handle(target => {
    Settings.renderSubPage(acctEmail!, tabId, $(target).attr('page')!, $(target).attr('addurltext') || ''); // all such elements do have page attr
  }));

  $('.action_show_encrypted_inbox').click(Ui.event.handle(target => {
    window.location.href = Env.urlCreate('/chrome/settings/inbox/inbox.htm', { acctEmail });
  }));

  $('.action_go_auth_denied').click(Ui.event.handle(() => Settings.renderSubPage(acctEmail!, tabId, '/chrome/settings/modules/auth_denied.htm')));

  $('.action_add_account').click(Ui.event.prevent('double', async () => await Settings.newGoogleAcctAuthPromptThenAlertOrForward(tabId)));

  $('.action_google_auth').click(Ui.event.prevent('double', async () => await Settings.newGoogleAcctAuthPromptThenAlertOrForward(tabId, acctEmail)));

  // $('.action_microsoft_auth').click(Ui.event.prevent('double', function() {
  //   new_microsoft_account_authentication_prompt(account_email);
  // }));

  $('body').click(Ui.event.handle(() => {
    $("#alt-accounts").removeClass("active");
    $(".ion-ios-arrow-down").removeClass("up");
    $(".add-account").removeClass("hidden");
  }));

  $(".toggle-settings").click(Ui.event.handle(() => {
    $("#settings").toggleClass("advanced");
  }));

  $(".action-toggle-accounts-menu").click(Ui.event.handle((target, event) => {
    event.stopPropagation();
    $("#alt-accounts").toggleClass("active");
    $(".ion-ios-arrow-down").toggleClass("up");
    $(".add-account").toggleClass("hidden");
  }));

  $('#status-row #status_google').click(Ui.event.handle(() => Settings.renderSubPage(acctEmail!, tabId, 'modules/debug_api.htm', { which: 'google_account' })));

  $('#status-row #status_local_store').click(Ui.event.handle(() => Settings.renderSubPage(acctEmail!, tabId, 'modules/debug_api.htm', { which: 'local_store' })));

  const reload = (advanced = false) => {
    if (advanced) {
      window.location.href = Env.urlCreate('/chrome/settings/index.htm', { acctEmail, advanced: true });
    } else {
      window.location.reload();
    }
  };

  await initialize();
  await Assert.abortAndRenderErrOnUnprotectedKey(acctEmail, tabId);
  if (page) {
    if (page === '/chrome/settings/modules/auth_denied.htm') {
      Settings.renderSubPage(acctEmail, tabId, page);
    } else {
      Settings.renderSubPage(acctEmail, tabId, page, pageUrlParams);
    }
  }

  await Settings.populateAccountsMenu('index.htm');

  Ui.setTestState('ready');

})();
