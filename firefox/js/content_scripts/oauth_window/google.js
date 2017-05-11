/* Business Source License 1.0 © 2016 FlowCrypt Limited (tom@cryptup.org). Use limitations apply. This version will change to GPLv3 on 2020-01-01. See https://github.com/CryptUp/cryptup-browser/tree/master/src/LICENCE */

'use strict';

var google_oauth2 = chrome.runtime.getManifest().oauth2;

function api_google_auth_state_unpack(status_string) {
  return JSON.parse(status_string.replace(google_oauth2.state_header, '', 1));
}

var interval = setInterval(function () {
  if(!document.title) {
    return;
  }
  clearInterval(interval);
  if(tool.value(google_oauth2.state_header).in(document.title)) { // this is cryptup's google oauth - based on a &state= passed on in auth request
    var parts = document.title.split(' ', 2);
    var result = parts[0];
    var params = tool.env.url_params(['code', 'state', 'error'], parts[1]);
    var state_object = api_google_auth_state_unpack(params.state);
    tool.browser.message.send('broadcast', 'google_auth_window_result', { result: result, params: params, state: state_object }, function () {
      var close_title = 'Close this window';
      $('title').text(close_title);
      tool.browser.message.send(null, 'close_popup', {title: close_title});
    });
  }
}, 50);