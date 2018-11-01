/* © 2016-2018 FlowCrypt Limited. Limitations apply. Contact human@flowcrypt.com */

'use strict';

/// <reference path="../../../node_modules/@types/chrome/index.d.ts" />

Catch.try(async () => {

  let gmail_webmail_startup = async () => {
    const replace_pgp_elements_interval_ms = 1000;
    let replace_pgp_elements_interval: number;
    let replacer: GmailElementReplacer;
    let host_page_info: WebmailVariantObject;

    let get_user_account_email = (): undefined|string => {
      if (window.location.search.indexOf('&view=btop&') === -1) {  // when view=btop present, FlowCrypt should not be activated
        if (host_page_info.email) {
          return host_page_info.email;
        }
        let account_email_loading_match = $("#loading div.msg").text().match(/[a-z0-9._\-]+@[^…< ]+/gi);
        if (account_email_loading_match !== null) { // try parse from loading div
          return account_email_loading_match[0].trim().toLowerCase();
        }
        let email_from_account_dropdown = $('div.gb_Cb > div.gb_Ib').text().trim().toLowerCase();
        if (Str.is_email_valid(email_from_account_dropdown)) {
          return email_from_account_dropdown;
        }
      }
    };

    let get_insights_from_host_variables = () => {
      let insights: WebmailVariantObject = {new_data_layer: null, new_ui: null, email: null, gmail_variant: null};
      $('body').append(['<script>', '(function() {', // xss-direct - not sanitized because adding a <script> in intentional here
        'let payload = JSON.stringify([String(window.GM_SPT_ENABLED), String(window.GM_RFT_ENABLED), String((window.GLOBALS || [])[10])]);',
        'let e = document.getElementById("FC_VAR_PASS");',
        'if (!e) {e = document.createElement("div");e.style="display:none";e.id="FC_VAR_PASS";document.body.appendChild(e)}',
        'e.innerText=payload;',
      '})();', '</script>'].join('')); // executed synchronously - we can read the vars below
      try {
        let extracted = JSON.parse($('body > div#FC_VAR_PASS').text()).map(String);
        if (extracted[0] === 'true') {
          insights.new_data_layer = true;
        } else if (extracted[0] === 'false') {
          insights.new_data_layer = false;
        }
        if (extracted[1] === 'true') {
          insights.new_ui = true;
        } else if (extracted[1] === 'false') {
          insights.new_ui = false;
        }
        if (Str.is_email_valid(extracted[2])) {
          insights.email = extracted[2].trim().toLowerCase();
        }
        if (insights.new_data_layer === null && insights.new_ui === null && insights.email === null) {
          insights.gmail_variant = 'html';
        } else if (insights.new_ui === false) {
          insights.gmail_variant = 'standard';
        } else if (insights.new_ui === true) {
          insights.gmail_variant = 'new';
        }
      } catch (e) {} // tslint:disable-line:no-empty
      return insights;
    };

    let start = async (account_email: string, injector: Injector, notifications: Notifications, factory: XssSafeFactory, notify_murdered: () => void) => {
      hijack_gmail_hotkeys();
      let storage = await Store.get_account(account_email, ['addresses', 'google_token_scopes']);
      let can_read_emails = Api.gmail.has_scope(storage.google_token_scopes || [], 'read');
      injector.buttons();
      replacer = new GmailElementReplacer(factory, account_email, storage.addresses || [account_email], can_read_emails, injector, notifications, host_page_info.gmail_variant);
      await notifications.show_initial(account_email);
      replacer.everything();
      replace_pgp_elements_interval = (window as ContentScriptWindow).TrySetDestroyableInterval(() => {
        if (typeof (window as FcWindow).$ === 'function') {
          replacer.everything();
        } else { // firefox will unload jquery when extension is restarted or updated
          clearInterval(replace_pgp_elements_interval);
          notify_murdered();
        }
      }, replace_pgp_elements_interval_ms);
    };

    let hijack_gmail_hotkeys = () => {
      let keys = Env.key_codes();
      let unsecure_reply_key_shortcuts = [keys.a, keys.r, keys.A, keys.R, keys.f, keys.F];
      $(document).keypress(e => {
        Catch.try(() => {
          let causes_unsecure_reply = Value.is(e.which).in(unsecure_reply_key_shortcuts);
          if (causes_unsecure_reply && !$(document.activeElement).is('input, select, textarea, div[contenteditable="true"]') && $('iframe.reply_message').length) {
            e.stopImmediatePropagation();
            replacer.set_reply_box_editable();
          }
        })();
      });
    };

    host_page_info = get_insights_from_host_variables();
    await content_script_setup_if_vacant({
      name: 'gmail',
      variant: host_page_info.gmail_variant,
      get_user_account_email,
      get_user_full_name: () => $("div.gb_hb div.gb_lb").text() || $("div.gb_Fb.gb_Hb").text(),
      get_replacer: () => replacer,
      start,
    });
  };

  let inbox_webmail_startup = async () => {
    const replace_pgp_elements_interval_ms = 1000;
    let replace_pgp_elements_interval: number;
    let replacer: InboxElementReplacer;
    let full_name = '';

    let start = async (account_email: string, injector: Injector, notifications: Notifications, factory: XssSafeFactory, notify_murdered: () => void) => {
      let storage = await Store.get_account(account_email, ['addresses', 'google_token_scopes']);
      let can_read_emails = Api.gmail.has_scope(storage.google_token_scopes || [], 'read');
      injector.buttons();
      replacer = new InboxElementReplacer(factory, account_email, storage.addresses || [account_email], can_read_emails, injector, null);
      await notifications.show_initial(account_email);
      replacer.everything();
      replace_pgp_elements_interval = (window as ContentScriptWindow).TrySetDestroyableInterval(() => {
        if (typeof (window as FcWindow).$ === 'function') {
          replacer.everything();
        } else { // firefox will unload jquery when extension is restarted or updated
          clearInterval(replace_pgp_elements_interval);
          notify_murdered();
        }
      }, replace_pgp_elements_interval_ms);
    };

    await content_script_setup_if_vacant({
      name: 'inbox',
      variant: 'standard',
      get_user_account_email: () => {
        let credentials = $('div > div > a[href="https://myaccount.google.com/privacypolicy"]').parent().siblings('div');
        if (credentials.length === 2 &&  credentials[0].innerText && credentials[1].innerText && Str.is_email_valid(credentials[1].innerText)) {
          let account_email = credentials[1].innerText.toLowerCase();
          full_name =  credentials[0].innerText;
          console.info('Loading for ' + account_email + ' (' + full_name + ')');
          return account_email;
        }
      },
      get_user_full_name: () => full_name,
      get_replacer: () => replacer,
      start,
    });
  };

  if (window.location.host !== 'inbox.google.com') {
    await gmail_webmail_startup();
  } else {
    await inbox_webmail_startup(); // to be deprecated by Google in 2019
  }

})();
