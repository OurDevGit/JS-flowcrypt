/* © 2016-2018 FlowCrypt Limited. Limitations apply. Contact human@flowcrypt.com */

'use strict';

tool.catch.try(async () => {

  tool.ui.event.protect();

  let url_params = tool.env.url_params(['account_email', 'message_id', 'attachment_id', 'name', 'type', 'size', 'url', 'parent_tab_id', 'content', 'decrypted', 'frame_id']);
  let account_email = tool.env.url_param_require.string(url_params, 'account_email');
  let parent_tab_id = tool.env.url_param_require.string(url_params, 'parent_tab_id');
  url_params.size = url_params.size ? parseInt(url_params.size as string) : undefined;
  let original_name = url_params.name ? (url_params.name as string).replace(/\.(pgp|gpg)$/ig, '') : 'noname';

  let original_html_content: string;
  let button = $('#download');
  let progress_element: JQuery<HTMLElement>;

  let passphrase_interval: number|undefined;
  let missing_passprase_longids: string[] = [];

  $('#type').text(url_params.type as string);
  $('#name').text(url_params.name as string);

  $('img#file-format').attr('src', (() => {
    let icon = (name: string) => `/img/fileformat/${name}.png`;
    let name_split = original_name.split('.');
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

  let get_original_name = (name: string) => {
    return name.replace(/(\.pgp)|(\.gpg)$/, '');
  };

  let decrypt_and_save_attachment_to_downloads = async (encrypted_data: Uint8Array) => {
    let result = await tool.crypto.message.decrypt(account_email, encrypted_data, null, true);
    $('#download').html(original_html_content).removeClass('visible');
    if (result.success) {
      let filename = result.content.filename;
      if (!filename || tool.value(filename).in(['msg.txt', 'null'])) {
        filename = get_original_name(url_params.name as string);
      }
      tool.file.save_to_downloads(filename, url_params.type as string, result.content.uint8!, $('body')); // uint8!: requested uint8 above
    } else if (result.error.type === DecryptErrorTypes.need_passphrase) {
      tool.browser.message.send(parent_tab_id, 'passphrase_dialog', {type: 'attachment', longids: result.longids.need_passphrase});
      clearInterval(passphrase_interval);
      passphrase_interval = window.setInterval(check_passphrase_entered, 1000);
    } else {
      delete result.message;
      console.info(result);
      $('body.attachment').html('Error opening file<br>Downloading original..');
      tool.file.save_to_downloads(url_params.name as string, url_params.type as string, encrypted_data);
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
    original_html_content = button.html();
    button.addClass('visible');
    button.html(tool.ui.spinner('green', 'large_spinner') + '<span class="download_progress"></span>');
    await recover_missing_attachment_id_if_needed();
    progress_element = $('.download_progress');
    if (url_params.decrypted) { // when content was downloaded and decrypted
      tool.file.save_to_downloads(get_original_name(url_params.name as string), url_params.type as string, tool.str.to_uint8(url_params.decrypted as string), tool.env.browser().name === 'firefox' ? $('body') : null);
    } else if (url_params.content) { // when encrypted content was already downloaded
      await decrypt_and_save_attachment_to_downloads(tool.str.to_uint8(url_params.content as string));
    } else if (url_params.attachment_id) { // gmail attachment_id
      let attachment = await tool.api.gmail.attachment_get(account_email, url_params.message_id as string, url_params.attachment_id as string, render_progress);
      await decrypt_and_save_attachment_to_downloads(tool.str.to_uint8(tool.str.base64url_decode(attachment.data as string)));
    } else if (url_params.url) { // gneneral url to download attachment
      let data = await tool.file.download_as_uint8(url_params.url as string, render_progress);
      await decrypt_and_save_attachment_to_downloads(data);
    } else {
      throw Error('Missing both attachment_id and url');
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

  try {
    if (url_params.message_id && url_params.attachment_id && tool.file.treat_as(tool.file.attachment(original_name, url_params.type as string, url_params.content as string)) === 'public_key') {
      // this is encrypted public key - download && decrypt & parse & render
      let attachment = await tool.api.gmail.attachment_get(account_email, url_params.message_id as string, url_params.attachment_id as string);
      let encrypted_data = tool.str.base64url_decode(attachment.data as string);
      let result = await tool.crypto.message.decrypt(account_email, encrypted_data);
      if (result.success && result.content.text && tool.crypto.message.is_openpgp(result.content.text)) { // todo - specifically check that it's a pubkey within tool.crypto.message.resembles_beginning
        // render pubkey
        tool.browser.message.send(parent_tab_id, 'render_public_keys', {after_frame_id: url_params.frame_id, traverse_up: 2, public_keys: [result.content.text]});
        // hide attachment
        tool.browser.message.send(parent_tab_id, 'set_css', {selector: `#${url_params.frame_id}`, traverse_up: 1, css: {display: 'none'}});
        $('body').text('');
      } else {
        // could not process as a pubkey - let user download it by clicking
        $('#download').click(tool.ui.event.prevent(tool.ui.event.double(), save_to_downloads));
      }
    } else {
      // standard encrypted attachment - let user download it by clicking
      $('#download').click(tool.ui.event.prevent(tool.ui.event.double(), save_to_downloads));
    }
  } catch (e) {
    tool.api.error.notify_parent_if_auth_popup_needed(account_email, parent_tab_id, e);
  }

})();
