/* ©️ 2016 - present FlowCrypt a.s. Limitations apply. Contact human@flowcrypt.com */

import { Config, Util } from '../../util';
import { AvaContext } from '../tooling/';
import { ControllablePage } from '../../browser';
import { PageRecipe } from './abstract-page-recipe';
import { Url } from '../../core/common';

export class OauthPageRecipe extends PageRecipe {

  private static longTimeout = 40;

  public static google = async (t: AvaContext, oauthPage: ControllablePage, acctEmail: string, action: "close" | "deny" | "approve" | 'login'): Promise<void> => {
    try {
      const isMock = oauthPage.target.url().includes('localhost') || oauthPage.target.url().includes('google.mock.flowcryptlocal.test');
      if (isMock) {
        const mockOauthUrl = oauthPage.target.url();
        const { login_hint } = Url.parse(['login_hint'], mockOauthUrl);
        if (action === 'close') {
          await oauthPage.close();
        } else if (!login_hint) {
          await oauthPage.target.goto(mockOauthUrl + '&login_hint=' + encodeURIComponent(acctEmail) + '&proceed=true');
        } else {
          await oauthPage.target.goto(mockOauthUrl + '&proceed=true');
        }
        return;
      }
    } catch (e) {
      if (String(e).includes('page has been closed')) {
        // the extension may close the auth page after success before we had a chance to evaluate it
        return; // in this case the login was already successful
      }
    }
    const auth = Config.secrets().auth.google.find(a => a.email === acctEmail);
    const acctPassword = auth?.password;
    const selectors = {
      approve_button: '#submit_approve_access',
      email_input: '#identifierId',
      email_confirm_btn: '#identifierNext',
      auth0_username: '#username',
      auth0_password: '#password',
      auth0_login_btn: 'button', // old: ._button-login
    };
    try {
      const alreadyLoggedSelector = '.w6VTHd, .wLBAL';
      const alreadyLoggedChooseOtherAccountSelector = '.bLzI3e, .BHzsHc';
      await oauthPage.waitAny(`#Email, #submit_approve_access, #identifierId, ${alreadyLoggedSelector}, #profileIdentifier`, { timeout: 45 });
      if (await oauthPage.target.$(selectors.email_input) !== null) { // 2017-style login
        await oauthPage.waitAll(selectors.email_input, { timeout: OauthPageRecipe.longTimeout });
        await oauthPage.waitAndType(selectors.email_input, acctEmail, { delay: 2 });
        await oauthPage.waitAndClick(selectors.email_confirm_btn, { delay: 2 });  // confirm email
        await oauthPage.waitForNavigationIfAny();
      } else if (await oauthPage.target.$(`#profileIdentifier[data-email="${acctEmail}"]`) !== null) { // already logged in - just choose an account
        await oauthPage.waitAndClick(`#profileIdentifier[data-email="${acctEmail}"]`, { delay: 1 });
      } else if (await oauthPage.target.$(alreadyLoggedSelector) !== null) { // select from accounts where already logged in
        await oauthPage.waitAndClick(alreadyLoggedChooseOtherAccountSelector, { delay: 1 }); // choose other account, also try .TnvOCe .k6Zj8d .XraQ3b
        await Util.sleep(2);
        return await OauthPageRecipe.google(t, oauthPage, acctEmail, action); // start from beginning after clicking "other email acct"
      } else if (await oauthPage.target.$('#profileIdentifier[data-email="dummy"]') !== null) {
        // let any e-mail pass
        const href = await oauthPage.attr('#profileIdentifier', 'href') + acctEmail;
        await oauthPage.goto(href);
      }
      await Util.sleep(2);
      if (action === 'login') {
        await Util.sleep(3);
        if (oauthPage.page.isClosed()) {
          return;
        }
        throw new Error('Oauth page didnt close after login. Should increase timeout or await close event');
      }
      await oauthPage.waitAny([selectors.approve_button, selectors.auth0_username]);
      if (await oauthPage.isElementPresent(selectors.auth0_username)) {
        await oauthPage.waitAndType(selectors.auth0_username, acctEmail);
        if (acctPassword) {
          await oauthPage.waitAndType(selectors.auth0_password, acctPassword);
        }
        await oauthPage.waitAndClick(selectors.auth0_login_btn);
        await oauthPage.waitForNavigationIfAny();
      }
      await Util.sleep(1);
      await oauthPage.waitAll(selectors.approve_button); // if succeeds, we are logged in and presented with approve/deny choice
      // since we are successfully logged in, we may save cookies to keep them fresh
      // no need to await the API call because it's not crucial to always save it, can mostly skip errors
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
