/* Business Source License 1.0 © 2016 Tom James Holub (tom@cryptup.org). Use limitations apply. This version will change to GPLv3 on 2020-01-01. See https://github.com/tomholub/cryptup-chrome/tree/master/src/LICENCE */

'use strict';

var gmail_oauth2 = chrome.runtime.getManifest().oauth2;

if(tool.value(gmail_oauth2.state_header).in(document.title)) { // this is cryptup's google oauth - based on a &state= passed on in auth request
  tool.browser.message.send(null, 'gmail_auth_code_result', { title: document.title }, window.close);
}
