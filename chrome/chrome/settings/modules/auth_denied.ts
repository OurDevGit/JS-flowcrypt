/* © 2016-2018 FlowCrypt Limited. Limitations apply. Contact human@flowcrypt.com */

'use strict';

tool.catch.try(async () => {

  let url_params = tool.env.url_params(['account_email', 'use_account_email', 'parent_tab_id', 'email_provider']);
  let account_email = url_params.account_email as string|undefined;
  let parent_tab_id = tool.env.url_param_require.string(url_params, 'parent_tab_id');

  if (!url_params.email_provider) {
    url_params.email_provider = 'gmail';
  }

  if (!url_params.account_email) {
    render_setup_done(false);
  } else {
    let {setup_done} = await Store.get_account(account_email!, ['setup_done']);
    render_setup_done(setup_done || false);
  }

  $('.hidable').not('.' + url_params.email_provider).css('display', 'none');

  if (url_params.email_provider === 'outlook') {
    $('.permission_send').text('Manage drafts and send emails');
    $('.permission_read').text('Read messages');
  } else { // gmail
    $('.permission_send').text('Manage drafts and send emails');
    $('.permission_read').text('Read messages');
  }

  $('.action_auth_proceed').click(function() {
    tool.browser.message.send(parent_tab_id, 'open_google_auth_dialog', { account_email: url_params.account_email });
  });

  $('.auth_action_limited').click(function() {
    tool.browser.message.send(parent_tab_id, 'open_google_auth_dialog', { omit_read_scope: true, account_email: url_params.account_email });
  });

  $('.close_page').click(function() {
    tool.browser.message.send(parent_tab_id, 'close_page');
  });

  function render_setup_done(setup_done: boolean) {
    if (setup_done) {
      $('.show_if_setup_done').css('display', 'block');
    } else {
      $('.show_if_setup_not_done').css('display', 'block');
    }
  }

})();
