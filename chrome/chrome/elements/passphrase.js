/* Business Source License 1.0 © 2016 FlowCrypt Limited (tom@cryptup.org). Use limitations apply. This version will change to GPLv3 on 2020-01-01. See https://github.com/CryptUp/cryptup-browser/tree/master/src/LICENCE */

'use strict';

tool.ui.event.protect();

var url_params = tool.env.url_params(['account_email', 'parent_tab_id', 'longids', 'type']);

if(url_params.type === 'embedded') {
  $('h1').parent().css('display', 'none');
  $('div.separator').css('display', 'none');
  $('body#settings > div#content.dialog').css({ width: 'inherit', background: '#fafafa', });
  $('.line.which_key').css({ display: 'none', position: 'absolute', visibility: 'hidden', left: '5000px', });
} else if(url_params.type === 'sign') {
  $('h1').text('Enter your pass phrase to sign email');
} else if(url_params.type === 'attest') {
  $('h1').text('Enter your pass phrase to confirm attestation');
}
tool.ui.passphrase_toggle(['passphrase']);

var all_private_keys = private_keys_get(url_params.account_email);

if(url_params.longids) {
  var private_keys = private_keys_get(url_params.account_email, url_params.longids.split(','));
} else {
  var private_keys = all_private_keys;
}


if(all_private_keys.length > 1) {
  if(private_keys.length === 1) {
    var html = 'For the following key: <span class="good">' + mnemonic(private_keys[0].longid) + '</span> (KeyWords)';
  } else {
    var html = 'Pass phrase needed for any of the following keys:';
    $.each(private_keys, function (i, keyinfo) {
      html += 'KeyWords ' + String(i + 1) + ': <div class="good">' + mnemonic(private_keys[i].longid) + '</div>';
    });
  }
  $('.which_key').html(html);
  $('.which_key').css('display', 'block');
}

function render_error() {
  $('#passphrase').val('');
  $('#passphrase').css('border-color', 'red');
  $('#passphrase').css('color', 'red');
  $('#passphrase').attr('placeholder', 'Please try again');
}

function render_normal() {
  $('#passphrase').css('border-color', '');
  $('#passphrase').css('color', 'black');
  $('#passphrase').focus();
}

$('.action_close').click(tool.ui.event.prevent(tool.ui.event.double(), function () {
  tool.browser.message.send('broadcast', 'passphrase_entry', {entered: false});
  tool.browser.message.send(url_params.parent_tab_id, 'close_dialog');
}));

$('.action_ok').click(tool.ui.event.prevent(tool.ui.event.double(), function () {
  var pass = $('#passphrase').val();
  var is_correct = false;
  $.each(private_keys, function (i, keyinfo) { // if passphrase matches more keys, it will save them all
    var prv = openpgp.key.readArmored(keyinfo.armored).keys[0];
    if(tool.crypto.key.decrypt(prv, pass).success) {
      is_correct = true;
      if($('.forget').prop('checked')) {
        save_passphrase('session', url_params.account_email, keyinfo.longid, pass);
      } else {
        save_passphrase('local', url_params.account_email, keyinfo.longid, pass);
      }
      tool.browser.message.send('broadcast', 'passphrase_entry', {entered: true});
      tool.browser.message.send(url_params.parent_tab_id, 'close_dialog');
      return false;
    }
  });
  if(!is_correct) {
    render_error();
    setTimeout(render_normal, 1500);
  }
}));

$('#passphrase').keyup(render_normal);
