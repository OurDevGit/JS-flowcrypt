/* ©️ 2016 - present FlowCrypt a.s. Limitations apply. Contact human@flowcrypt.com */

'use strict';

import { Dict, Str } from '../../core/common.js';
import { Mime, MimeEncodeType, SendableMsgBody } from '../../core/mime.js';
import { Att } from '../../core/att.js';
import { RecipientType } from '../api.js';
import { KeyStore } from '../../platform/store/key-store.js';

export type Recipients = { to?: string[], cc?: string[], bcc?: string[] };
export type ProviderContactsQuery = { substring: string };

type SendableMsgDefinition = {
  headers?: Dict<string>;
  from: string;
  recipients: Recipients;
  subject: string;
  body: SendableMsgBody;
  atts: Att[];
  thread?: string;
  type?: MimeEncodeType,
  isDraft?: boolean
};

export class SendableMsg {

  public sign?: (signable: string) => Promise<string>;

  public static create = async (acctEmail: string, { from, recipients, subject, body, atts, thread, type, isDraft }: SendableMsgDefinition): Promise<SendableMsg> => {
    const [primaryKi] = await KeyStore.get(acctEmail, ['primary']);
    const headers: Dict<string> = primaryKi ? { OpenPGP: `id=${primaryKi.longid}` } : {}; // todo - use autocrypt format
    return new SendableMsg(
      acctEmail,
      headers,
      isDraft === true,
      from,
      recipients,
      subject,
      body,
      atts || [],
      thread,
      type
    );
  }

  private constructor(
    public acctEmail: string,
    public headers: Dict<string>,
    isDraft: boolean,
    public from: string,
    public recipients: Recipients,
    public subject: string,
    public body: SendableMsgBody,
    public atts: Att[],
    public thread: string | undefined,
    public type: MimeEncodeType,
  ) {
    const allEmails = [...recipients.to || [], ...recipients.cc || [], ...recipients.bcc || []];
    if (!allEmails.length && !isDraft) {
      throw new Error('The To: field is empty. Please add recipients and try again');
    }
    const invalidEmails = allEmails.filter(email => !Str.isEmailValid(email));
    if (invalidEmails.length) {
      throw new Error(`The To: field contains invalid emails: ${invalidEmails.join(', ')}\n\nPlease check recipients and try again.`);
    }
  }

  public setSignMethod = (methodThatSignsData: (signable: string) => Promise<string>) => {
    if (this.type !== 'pgpMimeSigned') {
      throw new Error('Signing method may only be set on pgpMimeSigned type');
    }
    this.sign = methodThatSignsData;
  }

  public toMime = async () => {
    this.headers.From = this.from;
    for (const recipientTypeStr of Object.keys(this.recipients)) {
      const recipientType = recipientTypeStr as RecipientType;
      if (this.recipients[recipientType] && this.recipients[recipientType]!.length) {
        // todo - properly escape/encode this header using emailjs
        this.headers[recipientType[0].toUpperCase() + recipientType.slice(1)] = this.recipients[recipientType]!.map(h => h.replace(/[,]/g, '')).join(',');
      }
    }
    this.headers.Subject = this.subject;
    if (this.type === 'pgpMimeSigned' && this.sign) {
      return await Mime.encodePgpMimeSigned(this.body, this.headers, this.atts, this.sign);
    } else {
      return await Mime.encode(this.body, this.headers, this.atts, this.type);
    }
  }

}
