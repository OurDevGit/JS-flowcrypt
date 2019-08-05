/* © 2016-2018 FlowCrypt Limited. Limitations apply. Contact human@flowcrypt.com */

'use strict';

import { MessageToReplyOrForward } from './interfaces/composer-types.js';
import { Xss } from '../platform/xss.js';
import { Str } from '../core/common.js';
import { Ui } from '../browser.js';
import { Api, ProgressCb } from '../api/api.js';
import { Catch } from '../platform/catch.js';
import { ComposerComponent } from './interfaces/composer-component.js';
import { Google } from '../api/google.js';
import { Mime } from '../core/mime.js';
import { Buf } from '../core/buf.js';
import { FormatError, PgpMsg } from '../core/pgp.js';
import { BrowserMsg, Bm } from '../extension.js';
import { Store } from '../platform/store.js';

export class ComposerQuote extends ComposerComponent {
    private messageToReplyOrForward: MessageToReplyOrForward | undefined;
    private msgExpandingHTMLPart: string | undefined;

    get expandingHTMLPart(): string | undefined {
        return this.msgExpandingHTMLPart;
    }

    initActions(): void {
        // No need
    }

    public addTripleDotQuoteExpandBtn = async (msgId: string, method: ('reply' | 'forward')) => {
        if (!this.messageToReplyOrForward) {
            this.composer.S.cached('icon_show_prev_msg').show().addClass('progress');
            Xss.sanitizeAppend(this.composer.S.cached('icon_show_prev_msg'), '<div id="loader">0%</div>');
            this.composer.resizeComposeBox();
            try {
                this.messageToReplyOrForward = await this.getAndDecryptMessage(msgId, (progress) => this.setQuoteLoaderProgress(progress + '%'));
            } catch (e) {
                if (Api.err.isSignificant(e)) {
                    Catch.reportErr(e);
                }
                await Ui.modal.error(`Could not load quoted content, please try again.\n\n${Api.err.eli5(e)}`);
            }
            this.composer.S.cached('icon_show_prev_msg').find('#loader').remove();
            this.composer.S.cached('icon_show_prev_msg').removeClass('progress');
        }
        if (!this.messageToReplyOrForward) {
            this.composer.S.cached('icon_show_prev_msg').click(Ui.event.handle(async el => {
                this.composer.S.cached('icon_show_prev_msg').unbind('click');
                await this.addTripleDotQuoteExpandBtn(msgId, method);
                if (this.messageToReplyOrForward) {
                    this.composer.S.cached('icon_show_prev_msg').click();
                }
            }));
            return;
        }
        if (this.messageToReplyOrForward.text) {
            if (method === 'forward') {
                this.composer.S.cached('icon_show_prev_msg').remove();
                await this.appendForwardedMsg(this.messageToReplyOrForward.text);
            } else {
                if (!this.messageToReplyOrForward.headers.from || !this.messageToReplyOrForward.headers.date) {
                    this.composer.S.cached('icon_show_prev_msg').hide();
                    return;
                }
                const sentDate = new Date(String(this.messageToReplyOrForward.headers.date));
                this.msgExpandingHTMLPart = '<br><br>' + this.generateHTMLRepliedPart(this.messageToReplyOrForward.text, sentDate, this.messageToReplyOrForward.headers.from);
                this.setExpandingTextAfterClick(this.msgExpandingHTMLPart);
            }
        } else {
            this.composer.S.cached('icon_show_prev_msg').hide();
        }
    }

    public getAndDecryptMessage = async (msgId: string, progressCb?: ProgressCb): Promise<MessageToReplyOrForward | undefined> => {
        try {
            const { raw } = await Google.gmail.msgGet(this.urlParams.acctEmail, msgId, 'raw',
                progressCb ? (progress: number) => progressCb(progress * 0.6) : undefined);
            const message = await Mime.process(Buf.fromBase64UrlStr(raw!));
            const readableBlocks = message.blocks
                .filter(b => b.type === 'encryptedMsg' || b.type === 'plainText' || b.type === 'plainHtml');
            const encryptedCount = readableBlocks.filter(b => b.type === 'encryptedMsg').length;
            const decryptedAndFormatedContent: string[] = [];
            for (const [index, block] of readableBlocks.entries()) {
                const stringContent = String(block.content);
                if (block.type === 'encryptedMsg') {
                    const decrypted = await this.decryptMessage(Buf.fromUtfStr(stringContent));
                    const msgBlocks = await PgpMsg.fmtDecryptedAsSanitizedHtmlBlocks(Buf.fromUtfStr(decrypted));
                    const htmlBlock = msgBlocks.find(b => b.type === 'decryptedHtml');
                    const htmlParsed = Xss.htmlSanitizeAndStripAllTags(htmlBlock ? htmlBlock.content.toString() : 'No Content', '\n');
                    decryptedAndFormatedContent.push(Xss.htmlUnescape(htmlParsed));
                    if (progressCb) {
                        progressCb(60 + (40 / encryptedCount) * (index + 1));
                    }
                } else if (block.type === 'plainHtml') {
                    decryptedAndFormatedContent.push(Xss.htmlUnescape(Xss.htmlSanitizeAndStripAllTags(stringContent, '\n')));
                } else {
                    decryptedAndFormatedContent.push(stringContent);
                }
            }
            return { headers: { date: String(message.headers.date), from: message.from }, text: decryptedAndFormatedContent.join('\n').trim(), };
        } catch (e) {
            if (e instanceof FormatError) {
                Xss.sanitizeAppend(this.composer.S.cached('input_text'), `<br/>\n<br/>\n<br/>\n${Xss.escape(e.data)}`);
            } else if (Api.err.isNetErr(e)) {
                // todo: retry
            } else if (Api.err.isAuthPopupNeeded(e)) {
                BrowserMsg.send.notificationShowAuthPopupNeeded(this.urlParams.parentTabId, { acctEmail: this.urlParams.acctEmail });
            } else {
                Catch.reportErr(e);
            }
            return;
        }
    }

    private decryptMessage = async (encryptedData: Buf): Promise<string> => {
        const decryptRes = await PgpMsg.decrypt({ kisWithPp: await Store.keysGetAllWithPp(this.urlParams.acctEmail), encryptedData });
        if (decryptRes.success) {
            return decryptRes.content.toUtfStr();
        } else if (decryptRes.error && decryptRes.error.type === 'need_passphrase') {
            BrowserMsg.send.passphraseDialog(this.urlParams.parentTabId, { type: 'quote', longids: decryptRes.longids.needPassphrase });
            const wasPpEntered: boolean = await new Promise(resolve => {
                BrowserMsg.addListener('passphrase_entry', async (response: Bm.PassphraseEntry) => resolve(response.entered));
                BrowserMsg.listen(this.urlParams.parentTabId);
            });
            if (wasPpEntered) {
                return await this.decryptMessage(encryptedData); // retry with pp
            }
            return `\n(Skipping previous message quote)\n`;
        } else {
            return `\n(Failed to decrypt quote from previous message because: ${decryptRes.error.type}: ${decryptRes.error.message})\n`;
        }
    }

    private quoteText(text: string) {
        return text.split('\n').map(l => '<br>&gt; ' + l).join('\n');
    }

    private appendForwardedMsg = (text: string) => {
        Xss.sanitizeAppend(this.composer.S.cached('input_text'), `<br/><br/>Forwarded message:<br/><br/>&gt; ${this.quoteText(Xss.escape(text))}`);
        this.composer.resizeComposeBox();
    }

    private generateHTMLRepliedPart = (text: string, date: Date, from: string) => {
        return `On ${Str.fromDate(date).replace(' ', ' at ')}, ${from} wrote:${this.quoteText(Xss.escape(text))}`;
    }

    private setExpandingTextAfterClick = (expandedHTMLText: string) => {
        this.composer.S.cached('icon_show_prev_msg')
            .click(Ui.event.handle(el => {
                el.style.display = 'none';
                Xss.sanitizeAppend(this.composer.S.cached('input_text'), expandedHTMLText);
                this.msgExpandingHTMLPart = undefined;
                this.composer.S.cached('input_text').focus();
                this.composer.resizeComposeBox();
            }));
    }

    private setQuoteLoaderProgress = (text: string) => this.composer.S.cached('icon_show_prev_msg').find('#loader').text(text);
}
