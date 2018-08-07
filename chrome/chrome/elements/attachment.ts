/* © 2016-2018 FlowCrypt Limited. Limitations apply. Contact human@flowcrypt.com */

'use strict';

tool.catch.try(async () => {

  tool.ui.event.protect();

  let url_params = tool.env.url_params(['account_email', 'message_id', 'attachment_id', 'name', 'type', 'size', 'url', 'parent_tab_id', 'content', 'decrypted', 'frame_id']);
  let account_email = tool.env.url_param_require.string(url_params, 'account_email');
  let parent_tab_id = tool.env.url_param_require.string(url_params, 'parent_tab_id');
  url_params.size = url_params.size ? parseInt(url_params.size as string) : undefined;
  let original_name_based_on_filename = url_params.name ? (url_params.name as string).replace(/\.(pgp|gpg)$/ig, '') : 'noname';

  let decrypted_a: Attachment|null = null;
  let encrypted_a: Attachment|null = null;
  try {
    if(url_params.decrypted) {
      decrypted_a = new Attachment({name: original_name_based_on_filename, type: url_params.type as string|undefined, data: url_params.decrypted as string});
    } else {
      encrypted_a = new Attachment({
        name: original_name_based_on_filename,
        type: url_params.type as string|undefined,
        data: url_params.content as string|undefined,
        message_id: url_params.message_id as string|undefined,
        id: url_params.attachment_id as string|undefined,
        url: url_params.url as string|undefined,
      });
    }
  } catch(e) {
    tool.catch.handle_exception(e);
    return $('body.attachment').html(`Error processing params: ${String(e)}. Contact human@flowcrypt.com`);
  }

  let original_html_content: string;
  let button = $('#download');
  let progress_element: JQuery<HTMLElement>;

  let passphrase_interval: number|undefined;
  let missing_passprase_longids: string[] = [];

  $('#type').text(url_params.type as string);
  $('#name').text(url_params.name as string);

  $('img#file-format').attr('src', (() => {
    let icon = (name: string) => `/img/fileformat/${name}.png`;
    let name_split = original_name_based_on_filename.split('.');
    let extension = name_split[name_split.length - 1].toLowerCase();
    switch (extension) {
      case 'jpg':
      case 'jpeg':
        return icon('jpg');
      case 'xls':
      case 'xlsx':
        return icon('excel');
      case 'doc':
      case 'docx':
        return icon('word');
      case 'png':
        return icon('png');
      default:
        return icon('generic');
    }
  })());

  let check_passphrase_entered = () => { // todo - more or less copy-pasted from pgp_block.js, should use a common one. Also similar one in compose.js
    if (missing_passprase_longids) {
      Promise.all(missing_passprase_longids.map(longid => Store.passphrase_get(account_email, longid))).then(passphrases => {
        // todo - copy/pasted - unify
        // further - this approach is outdated and will not properly deal with WRONG passphrases that changed (as opposed to missing)
        // see pgp_block.js for proper common implmenetation
        if (passphrases.filter(passphrase => passphrase !== null).length) {
          missing_passprase_longids = [];
          clearInterval(passphrase_interval);
          $('#download').click();
        }
      });
    }
  };

  let get_url_file_size = (original_url: string): Promise<number|null> => new Promise((resolve, reject) => {
    console.info('trying to figure out file size');
    let url;
    if (tool.value('docs.googleusercontent.com/docs/securesc').in(url_params.url as string)) {
      try {
        let google_drive_file_id = original_url.split('/').pop()!.split('?').shift(); // we catch any errors below
        if (google_drive_file_id) {
          url = 'https://drive.google.com/uc?export=download&id=' + google_drive_file_id; // this one can actually give us headers properly
        } else {
          url =  original_url;
        }
      } catch (e) {
        url =  original_url;
      }
    } else {
      url = original_url;
    }
    let xhr = new XMLHttpRequest();
    xhr.open("HEAD", url, true);
    xhr.onreadystatechange = function() {
      if (this.readyState === this.DONE) {
        let size = xhr.getResponseHeader("Content-Length");
        if (size !== null) {
          resolve(parseInt(size));
        } else {
          console.info('was not able to find out file size');
          resolve(null);
        }
      }
    };
    xhr.send();
  });

  let decrypt_and_save_attachment_to_downloads = async (enc_a: Attachment) => {
    let result = await tool.crypto.message.decrypt(account_email, enc_a.data(), null, true);
    $('#download').html(original_html_content).removeClass('visible');
    if (result.success) {
      let name = result.content.filename;
      if (!name || tool.value(name).in(['msg.txt', 'null'])) {
        name = enc_a.name;
      }
      tool.file.save_to_downloads(new Attachment({name, type: enc_a.type, data: result.content.uint8!}), $('body')); // uint8!: requested uint8 above
    } else if (result.error.type === DecryptErrorTypes.need_passphrase) {
      tool.browser.message.send(parent_tab_id, 'passphrase_dialog', {type: 'attachment', longids: result.longids.need_passphrase});
      clearInterval(passphrase_interval);
      passphrase_interval = window.setInterval(check_passphrase_entered, 1000);
    } else {
      delete result.message;
      console.info(result);
      $('body.attachment').html('Error opening file<br>Downloading original..');
      tool.file.save_to_downloads(new Attachment({name: url_params.name as string, type: url_params.type as string, data: enc_a.data()}));
    }
  };

  if (!url_params.size && url_params.url) { // download url of an unknown size
    get_url_file_size(url_params.url as string).then(size => {
      if(size !== null) {
        url_params.size = size;
      }
    }).catch(tool.catch.handle_promise_error);
  }

  let render_progress = (percent: number, received: number, size: number) => {
    size = size || url_params.size as number;
    if (percent) {
      progress_element.text(percent + '%');
    } else if (size) {
      progress_element.text(Math.floor(((received * 0.75) / size) * 100) + '%');
    }
  };

  let save_to_downloads = async () => {
    try {
      original_html_content = button.html();
      button.addClass('visible');
      button.html(tool.ui.spinner('green', 'large_spinner') + '<span class="download_progress"></span>');
      await recover_missing_attachment_id_if_needed();
      progress_element = $('.download_progress');
      if (decrypted_a) { // when content was downloaded and decrypted
        tool.file.save_to_downloads(decrypted_a, tool.env.browser().name === 'firefox' ? $('body') : null);
      } else if (encrypted_a && encrypted_a.has_data()) { // when encrypted content was already downloaded
        await decrypt_and_save_attachment_to_downloads(encrypted_a);
      } else if (encrypted_a && encrypted_a.id && encrypted_a.message_id) { // gmail attachment_id
        let attachment = await tool.api.gmail.attachment_get(account_email, encrypted_a.message_id, encrypted_a.id, render_progress);
        encrypted_a.set_data(attachment.data);
        await decrypt_and_save_attachment_to_downloads(encrypted_a!);
      } else if (encrypted_a && encrypted_a.url) { // gneneral url to download attachment
        encrypted_a.set_data(await tool.file.download_as_uint8(encrypted_a.url, render_progress));
        await decrypt_and_save_attachment_to_downloads(encrypted_a);
      } else {
        console.log(encrypted_a);
        console.log(encrypted_a!.has_data());
        throw Error('Missing both id and url');
      }
    } catch(e) {
      let retry_button = `<a href="${window.location.href}">retry</a>`;
      if(tool.api.error.is_auth_popup_needed(e)) {
        tool.browser.message.send(parent_tab_id, 'notification_show_auth_popup_needed', {account_email});
        $('body.attachment').html(`Error downloading file: google auth needed. ${retry_button}`);
      } else if(tool.api.error.is_network_error(e)) {
        $('body.attachment').html(`Error downloading file: no internet. ${retry_button}`);
      } else {
        tool.catch.handle_exception(e);
        $('body.attachment').html(`Error downloading file: unknown error. ${retry_button}`);
      }
    }
  };

  let recover_missing_attachment_id_if_needed = async () => {
    if (!url_params.url && !url_params.attachment_id && url_params.message_id) {
      try {
        let result = await tool.api.gmail.message_get(account_email, url_params.message_id as string, 'full');
        if (result && result.payload && result.payload.parts) {
          for (let attachment_meta of result.payload.parts) {
            if (attachment_meta.filename === url_params.name && attachment_meta.body && attachment_meta.body.size === url_params.size && attachment_meta.body.attachmentId) {
              url_params.attachment_id = attachment_meta.body.attachmentId;
              break;
            }
          }
          return;
        } else {
          window.location.reload();
        }
      } catch (e) {
        window.location.reload();
      }
    }
  };

  let process_as_a_public_key_and_hide_attachment_if_appropriate = async () => {
    if (encrypted_a && encrypted_a.message_id && encrypted_a.id && encrypted_a.treat_as() === 'public_key') {
      // this is encrypted public key - download && decrypt & parse & render
      let attachment = await tool.api.gmail.attachment_get(account_email, url_params.message_id as string, url_params.attachment_id as string);
      let result = await tool.crypto.message.decrypt(account_email, attachment.data);
      if (result.success && result.content.text) {
        let openpgp_type = tool.crypto.message.type(result.content.text);
        if(openpgp_type && openpgp_type.type === 'public_key') {
          if(openpgp_type.armored) { // could potentially process unarmored pubkey files, maybe later
            // render pubkey
            tool.browser.message.send(parent_tab_id, 'render_public_keys', {after_frame_id: url_params.frame_id, traverse_up: 2, public_keys: [result.content.text]});
            // hide attachment
            tool.browser.message.send(parent_tab_id, 'set_css', {selector: `#${url_params.frame_id}`, traverse_up: 1, css: {display: 'none'}});
            $('body').text('');
            return true;
          }
        }
      }
    }
    return false;
  };

  try {
    if(!await process_as_a_public_key_and_hide_attachment_if_appropriate()) {
      // normal attachment, let user download it by clicking
      $('#download').click(tool.ui.event.prevent(tool.ui.event.double(), save_to_downloads));
    }
  } catch (e) {
    let retry_button = `<a href="${window.location.href}">retry</a>`;
    if(tool.api.error.is_auth_popup_needed(e)) {
      tool.browser.message.send(parent_tab_id, 'notification_show_auth_popup_needed', {account_email});
      $('body.attachment').html(`Error downloading file - google auth needed. ${retry_button}`);
    } else if(tool.api.error.is_network_error(e)) {
      $('body.attachment').html(`Error downloading file - no internet. ${retry_button}`);
    } else {
      tool.catch.handle_exception(e);
      $('body.attachment').html(`Error downloading file - unknown error. ${retry_button}`);
    }
  }

})();
