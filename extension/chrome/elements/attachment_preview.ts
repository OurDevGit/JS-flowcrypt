/* ©️ 2016 - present FlowCrypt a.s. Limitations apply. Contact human@flowcrypt.com */

'use strict';

import { Att } from '../../js/common/core/att.js';
import { AttachmentDownloadView } from './attachment.js';
import { AttachmentPreviewPdf } from '../../js/common/ui/attachment_preview_pdf.js';
import { Browser } from '../../js/common/browser/browser.js';
import { BrowserMsg } from '../../js/common/browser/browser-msg.js';
import { KeyStore } from '../../js/common/platform/store/key-store.js';
import { PDFDocumentProxy } from '../../types/pdf.js';
import { MsgUtil, DecryptError, DecryptSuccess } from '../../js/common/core/crypto/pgp/msg-util.js';
import { View } from '../../js/common/view.js';
import { Xss } from '../../js/common/platform/xss.js';
import { Ui } from '../../js/common/browser/ui.js';

type AttachmentType = 'img' | 'txt' | 'pdf';

declare const pdfjsLib: any; // tslint:disable-line:ban-types

View.run(class AttachmentPreviewView extends AttachmentDownloadView {
  private attachmentPreviewContainer = $('#attachment-preview-container');

  constructor() {
    super();
  }

  public render = async () => {
    try {
      Xss.sanitizeRender(this.attachmentPreviewContainer, `${Ui.spinner('green', 'large_spinner')}<span class="download_progress"></span>`);
      this.att = new Att({ name: this.origNameBasedOnFilename, type: this.type, msgId: this.msgId, id: this.id, url: this.url });
      await this.downloadDataIfNeeded();
      const result = this.isEncrypted ? await this.decrypt() : this.att.getData();
      if (result) {
        const blob = new Blob([result], { type: this.type });
        const url = window.URL.createObjectURL(blob);
        const attachmentType = this.getAttachmentType(this.origNameBasedOnFilename);
        const attForSave = new Att({ name: this.origNameBasedOnFilename, type: this.type, data: result });
        if (attachmentType) {
          if (attachmentType === 'img') { // image
            this.attachmentPreviewContainer.html(`<img src="${url}" class="attachment-preview-img" alt="${Xss.escape(this.origNameBasedOnFilename)}">`); // xss-escaped
          } else if (attachmentType === 'txt') { // text
            this.attachmentPreviewContainer.html(`<div class="attachment-preview-txt">${Xss.escape(result.toString()).replace(/\n/g, '<br>')}</div>`); // xss-escaped
          } else if (attachmentType === 'pdf') { // PDF
            pdfjsLib.getDocument({ data: result }).promise.then(async (pdf: PDFDocumentProxy) => { // tslint:disable-line:no-unsafe-any
              const previewPdf = new AttachmentPreviewPdf(this.attachmentPreviewContainer, pdf);
              await previewPdf.render();
            });
          }
        } else { // no preview available, download button
          this.attachmentPreviewContainer.html('<div class="attachment-preview-unavailable"></div>'); // xss-escaped
          $('.attachment-preview-unavailable').prepend('No preview available'); // xss-escaped
          $('#attachment-preview-download').appendTo('.attachment-preview-unavailable');
        }
        $('body').click((e) => {
          if (e.target === document.body || $('body').children().toArray().indexOf(e.target) !== -1) {
            BrowserMsg.send.closeSwal(this.parentTabId);
          }
        });
        $('#attachment-preview-download').css('display', 'flex').click((e) => {
          e.stopPropagation();
          Browser.saveToDownloads(attForSave);
        });
      }
    } catch (e) {
      this.renderErr(e);
    }
  }

  private getAttachmentType = (filename: string): AttachmentType | undefined => {
    const nameSplit = filename.split('.');
    const extension = nameSplit[nameSplit.length - 1].toLowerCase();
    if (['jpg', 'jpeg', 'png', 'gif'].includes(extension)) {
      return 'img';
    } else if (extension === 'txt') {
      return 'txt';
    } else if (extension === 'pdf') {
      return 'pdf';
    }
    return undefined;
  }

  private decrypt = async () => {
    const result = await MsgUtil.decryptMessage({ kisWithPp: await KeyStore.getAllWithPp(this.acctEmail), encryptedData: this.att.getData() });
    if ((result as DecryptSuccess).content) {
      return result.content;
    }
    throw new Error((result as DecryptError).error.message);
  }
});
