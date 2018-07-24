/* © 2016-2018 FlowCrypt Limited. Limitations apply. Contact human@flowcrypt.com */

'use strict';

tool.catch.try(async () => {

  let url_params = tool.env.url_params(['account_email', 'parent_tab_id', 'placement']);
  let account_email = tool.env.url_param_require.string(url_params, 'account_email');
  let parent_tab_id = tool.env.url_param_require.string(url_params, 'parent_tab_id');
  let hash = tool.crypto.hash.sha1;
  let container = $('.emails');

  let storage = await Store.get_account(account_email, ['addresses']);
  let addresses = storage.addresses || [url_params.account_email];

  let address_to_html_radio = (a: string) => {
    return `<input type="radio" name="a" value="${tool.str.html_escape(a)}" id="${hash(a)}"> <label data-test="action-choose-address" for="${hash(a)}">${a}</label><br>`;
  };

  container.html(addresses.map(address_to_html_radio).join(''));
  container.find('input').first().prop('checked', true);
  container.find('input').click(function() {
    let chosen_sending_address = $(this).val() as string;
    if (chosen_sending_address !== addresses[0]) {
      let ordered_addresses = tool.arr.unique([chosen_sending_address].concat(storage.addresses || []));
      Store.set(account_email, {addresses: ordered_addresses}).then(() => window.location.reload()).catch(tool.catch.handle_promise_error);
    }
  });

  $('.action_fetch_aliases').click(tool.ui.event.prevent(tool.ui.event.parallel(), (self, id) => {
    $(self).html(tool.ui.spinner('green'));
    Settings.fetch_account_aliases_from_gmail(account_email).then(addresses => {
      Store.set(account_email, { addresses: tool.arr.unique(addresses.concat(account_email)) }).then(() => window.location.reload());
    });
  }));

  $('.action_close').click(tool.ui.event.prevent(tool.ui.event.double(), () => tool.browser.message.send(parent_tab_id, 'close_dialog')));

})();
