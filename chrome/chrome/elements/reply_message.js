/* Business Source License 1.0 © 2016 FlowCrypt Limited (tom@cryptup.org). Use limitations apply. This version will change to GPLv3 on 2020-01-01. See https://github.com/CryptUp/cryptup-browser/tree/master/src/LICENCE */

'use strict';

tool.ui.event.protect();

var url_params = tool.env.url_params(['account_email', 'from', 'to', 'subject', 'frame_id', 'thread_id', 'thread_message_id', 'parent_tab_id', 'skip_click_prompt', 'ignore_draft']);

storage_cryptup_subscription(function(subscription_level, subscription_expire, subscription_active) {
  var subscription = {level: subscription_level, expire: subscription_expire, active: subscription_active};
  db_open(function (db) {

    account_storage_get(url_params.account_email, ['email_provider', 'addresses'], function(storage) {
      var email_provider = storage.email_provider || 'gmail';

      if (db === db_denied) { // todo - should probably be moved to top
        notify_about_storage_access_error(url_params.account_email, url_params.parent_tab_id);
        return;
      }

      var original_reply_message_prompt = undefined;
      var can_read_emails = undefined;
      url_params.skip_click_prompt = Boolean(Number(url_params.skip_click_prompt || ''));
      url_params.ignore_draft = Boolean(Number(url_params.ignore_draft || ''));

      var factory = element_factory(url_params.account_email, url_params.parent_tab_id);
      var compose = init_shared_compose_js(url_params, db, subscription, reply_message_render_success);

      function recover_missing_url_params(callback) {
        if (email_provider === 'outlook') { // nothing is parsed from ui, everything except thread_id needs to be pulled from api
          tool.api.outlook.message_thread(url_params.account_email, url_params.thread_id, function(success, response) {
            if(success && response && response.value && response.value.length) {
              url_params.thread_id = tool.arr.select(response.value, 'Id');
              var last_msg = response.value[response.value.length - 1];
              url_params.to = tool.api.common.reply_correspondents(url_params.account_email, storage.addresses, last_msg.From.EmailAddress.Address, last_msg.ToRecipients.map(function(r) {
                return r.EmailAddress.Address;
              })).to;
            } else {
              $('body').html('Failed to load conversation info. <a href="#">Reload</a>').find('a').click(function() {
                window.location.reload();
              });
            }
          });
        } else if(url_params.thread_id && url_params.thread_id !== url_params.thread_message_id && url_params.to && url_params.from && url_params.subject) {
          callback();
        } else {
          tool.api.gmail.message_get(url_params.account_email, url_params.thread_message_id, 'metadata', function (success, gmail_message_object) {
            if (success) {
              url_params.thread_id = gmail_message_object.threadId;
              var reply = tool.api.common.reply_correspondents(url_params.account_email, storage.addresses, tool.api.gmail.find_header(gmail_message_object, 'from'), (tool.api.gmail.find_header(gmail_message_object, 'to') || '').split(','));
              if(!url_params.to) {
                url_params.to = reply.to;
              }
              if(!url_params.from) {
                url_params.from = reply.from;
              }
              if(!url_params.subject) {
                url_params.subject = tool.api.gmail.find_header(gmail_message_object, 'subject');
              }
            } else {
              if(!url_params.from) {
                url_params.from = url_params.account_email;
              }
              if(!url_params.subject) {
                url_params.subject = '';
              }
              url_params.thread_id = url_params.thread_id || url_params.thread_message_id;
              console.log('CRYPTUP: Substituting thread_id: could cause issues. Value:' + String(url_params.thread_id));
            }
            callback();
          });
        }
      }

      function reply_message_render_table(method) {
        $('div#reply_message_prompt').css('display', 'none');
        $('div#reply_message_table_container').css('display', 'block');
        reply_message_on_render();
        if(email_provider === 'gmail') {
          if (can_read_emails) {
            reply_message_determine_gmail_header_variables(method === 'forward');
          } else {
            $('div#reply_message_prompt').html('CryptUp has limited functionality. Your browser needs to access this conversation to reply.<br/><br/><br/><div class="button green auth_settings">Add missing permission</div><br/><br/>Alternatively, <a href="#" class="new_message_button">compose a new secure message</a> to respond.<br/><br/>');
            $('div#reply_message_prompt').attr('style', 'border:none !important');
            $('.auth_settings').click(function () {
              tool.browser.message.send(null, 'settings', { account_email: url_params.account_email, page: '/chrome/settings/modules/auth_denied.htm'});
            });
            $('.new_message_button').click(function () {
              tool.browser.message.send(url_params.parent_tab_id, 'open_new_message');
            });
          }
        }
      }

      function reply_message_determine_gmail_header_variables(load_last_message_for_forward) {
        tool.api.gmail.thread_get(url_params.account_email, url_params.thread_id, 'full', function (success, thread) {
          if (success && thread.messages && thread.messages.length > 0) {
            var thread_message_id_last = tool.api.gmail.find_header(thread.messages[thread.messages.length - 1], 'Message-ID') || '';
            var thread_message_referrences_last = tool.api.gmail.find_header(thread.messages[thread.messages.length - 1], 'In-Reply-To') || '';
            compose.headers({ 'In-Reply-To': thread_message_id_last, 'References': thread_message_referrences_last + ' ' + thread_message_id_last });
            if (load_last_message_for_forward) {
              url_params.subject = 'Fwd: ' + url_params.subject;
              retrieve_decrypt_and_add_forwarded_message(thread.messages[thread.messages.length - 1].id);
            }
          }
        });
      }

      function append_forwarded_message(text) {
        $('#input_text').append('<br/><br/>Forwarded message:<br/><br/>> ' + text.replace(/(?:\r\n|\r|\n)/g, '\> '));
        compose.resize_reply_box();
      }

      function retrieve_decrypt_and_add_forwarded_message(message_id) {
        tool.api.gmail.extract_armored_block(url_params.account_email, message_id, 'full', function (armored_message) {
          tool.crypto.message.decrypt(db, url_params.account_email, armored_message, undefined, function (result) {
            if (result.success) {
              if (!tool.mime.resembles_message(result.content.data)) {
                append_forwarded_message(tool.mime.format_content_to_display(result.content.data, armored_message));
              } else {
                tool.mime.decode(result.content.data, function (success, mime_parse_result) {
                  append_forwarded_message(tool.mime.format_content_to_display(mime_parse_result.text || mime_parse_result.html || result.content.data, armored_message));
                });
              }
            } else {
              $('#input_text').append('<br/>\n<br/>\n<br/>\n' + armored_message.replace(/\n/g, '<br/>\n'));
            }
          });
        }, function (error_type, url_formatted_data_block) {
          if (url_formatted_data_block) {
            $('#input_text').append('<br/>\n<br/>\n<br/>\n' + url_formatted_data_block);
          }
        });
      }

      $('.delete_draft').click(function () {
        compose.draft_delete(url_params.account_email, function () {
          tool.browser.message.send(url_params.parent_tab_id, 'close_reply_message', {
            frame_id: url_params.frame_id,
            thread_id: url_params.thread_id
          });
        });
      });

      function reply_message_render_success(message, plaintext, email_footer, message_id) {
        $('#send_btn_note').text('Deleting draft..');
        compose.draft_delete(url_params.account_email, function () {
          var is_signed = compose.S.cached('icon_sign').is('.active');
          reply_message_reinsert_reply_box(message_id);
          tool.browser.message.send(url_params.parent_tab_id, 'notification_show', { notification: 'Your ' + (is_signed ? 'signed' : 'encrypted') + ' reply has been sent.' });
          if(is_signed) {
            $('.replied_body').addClass('pgp_neutral').removeClass('pgp_secure');
          }
          $('.replied_body').css('width', $('table#compose').width() - 30);
          $('#reply_message_table_container').css('display', 'none');
          $('#reply_message_successful_container div.replied_from').text(url_params.from);
          $('#reply_message_successful_container div.replied_to span').text(message.to);
          $('#reply_message_successful_container div.replied_body').html(plaintext.replace(/\n/g, '<br>'));
          if (email_footer) {
            if(is_signed) {
              $('.replied_body').append('<br><br>' + email_footer.replace(/\n/g, '<br>'));
            } else {
              $('#reply_message_successful_container .email_footer').html('<br>' + email_footer.replace(/\n/g, '<br>'));
            }
          }
          var t = new Date();
          var time = ((t.getHours() != 12) ? (t.getHours() % 12) : 12) + ':' + t.getMinutes() + ((t.getHours() >= 12) ? ' PM ' : ' AM ') + '(0 minutes ago)';
          $('#reply_message_successful_container div.replied_time').text(time);
          $('#reply_message_successful_container').css('display', 'block');
          if (message.attachments.length) { // todo - will not work with cryptup uploaded attachments. Why extra request, anyway?
            tool.api.gmail.message_get(url_params.account_email, message_id, 'full', function (success, gmail_message_object) {
              if (success) {
                $('#attachments').css('display', 'block');
                var attachment_metas = tool.api.gmail.find_attachments(gmail_message_object);
                tool.each(attachment_metas, function (i, attachment_meta) {
                  $('#attachments').append(factory.embedded.attachment(attachment_meta, []));
                });
              } else {
                console.log('failed to re-show sent attachments'); //todo - handle !success
              }
              compose.resize_reply_box();
            });
          } else {
            compose.resize_reply_box();
          }
        });
      }

      function reply_message_reinsert_reply_box(last_message_id) {
        tool.browser.message.send(url_params.parent_tab_id, 'reinsert_reply_box', {
          account_email: url_params.account_email,
          my_email: url_params.from,
          subject: url_params.subject,
          their_email: compose.get_recipients_from_dom().join(','),
          thread_id: url_params.thread_id,
          thread_message_id: last_message_id,
        });
      }

      function reply_message_on_render() {
        $('#input_to').val(url_params.to + (url_params.to ? ',' : '')); // the comma causes the last email to be get evaluated
        compose.on_render();
        $("#input_to").focus();
        if (url_params.to) {
          $('#input_text').focus();
          document.getElementById("input_text").focus();
          compose.evaluate_receivers();
        }
        setTimeout(function () { // delay automatic resizing until a second later
          $(window).resize(tool.ui.event.prevent(tool.ui.event.spree('veryslow'), compose.resize_reply_box));
          $('#input_text').keyup(compose.resize_reply_box);
        }, 1000);
        compose.resize_reply_box();
      }

      if(email_provider === 'outlook') {
        $('#reply_message_prompt').click(reply_message_render_table).css({'min-height': '40px', 'cursor': 'text'});
        $('#reply_links').text('Click here to reply encrypted').css({'padding-left': '20px', 'padding-top': '8px'});
        $('table#compose td#input_addresses_container, .replied_from, .replied_to').css({'padding-left': '20px'});
      }

      recover_missing_url_params(function () {
        // show decrypted draft if available for this thread. Also check if read scope is available.
        if(email_provider === 'gmail') {
          account_storage_get(url_params.account_email, ['drafts_reply', 'google_token_scopes'], function (storage) {
            can_read_emails = tool.api.gmail.has_scope(storage.google_token_scopes, 'read');
            if (!url_params.ignore_draft && storage.drafts_reply && storage.drafts_reply[url_params.thread_id]) { // there is a draft
              original_reply_message_prompt = $('div#reply_message_prompt').html();
              $('div#reply_message_prompt').html(tool.ui.spinner('green') + ' Loading draft');
              tool.api.gmail.draft_get(url_params.account_email, storage.drafts_reply[url_params.thread_id], 'raw', function (success, response) {
                if (success) {
                  compose.draft_set_id(storage.drafts_reply[url_params.thread_id]);
                  tool.mime.decode(tool.str.base64url_decode(response.message.raw), function (mime_success, parsed_message) {
                    if (tool.value(tool.crypto.armor.headers('message').end).in(parsed_message.text || tool.crypto.armor.strip(parsed_message.html))) {
                      var stripped_text = parsed_message.text || tool.crypto.armor.strip(parsed_message.html);
                      compose.decrypt_and_render_draft(url_params.account_email, stripped_text.substr(stripped_text.indexOf(tool.crypto.armor.headers('message').begin)), reply_message_render_table); // todo - regex is better than random clipping
                    } else {
                      console.log('tool.api.gmail.draft_get tool.mime.decode else {}');
                      reply_message_render_table();
                    }
                  });
                } else {
                  reply_message_render_table();
                  if (response.status === 404) {
                    catcher.log('about to reload reply_message automatically: get draft 404', url_params.account_email);
                    setTimeout(function () {
                      compose.draft_meta_store(false, storage.drafts_reply[url_params.thread_id], url_params.thread_id, null, null, function () {
                        console.log('Above red message means that there used to be a draft, but was since deleted. (not an error)');
                        window.location.reload();
                      });
                    }, 500);
                  } else {
                    console.log('tool.api.gmail.draft_get success===false');
                    console.log(response);
                  }
                }
              });
            } else { //no draft available
              if (!url_params.skip_click_prompt) {
                $('#reply_click_area, #a_reply, #a_reply_all, #a_forward').click(function () {
                  if ($(this).attr('id') === 'a_reply') {
                    url_params.to = url_params.to.split(',')[0];
                  } else if ($(this).attr('id') === 'a_forward') {
                    url_params.to = '';
                  }
                  reply_message_render_table($(this).attr('id').replace('a_', ''));
                });
              } else {
                reply_message_render_table();
              }
            }
          });
        }
      });

      $(document).ready(function () {
        compose.resize_reply_box();
      });

    });
  });
});