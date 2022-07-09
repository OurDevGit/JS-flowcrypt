/* ©️ 2016 - present FlowCrypt a.s. Limitations apply. Contact human@flowcrypt.com */

'use strict';

import { isFesUsed } from '../helpers.js';
import { EnterpriseServer } from './account-servers/enterprise-server.js';
import { BackendRes, FcUuidAuth, FlowCryptComApi, ProfileUpdate } from './account-servers/flowcrypt-com-api.js';
import { ParsedRecipients } from './email-provider/email-provider-api.js';
import { Api, ProgressCb } from './shared/api.js';

export type UploadedMessageData = {
  url: string, // both FES and FlowCryptComApi
  externalId?: string, // legacy FES
  emailToExternalIdAndUrl?: { [email: string]: { url: string, externalId: string } } // FES only
};

/**
 * This may be calling to FlowCryptComApi or Enterprise Server (FES, customer on-prem) depending on
 *   whether FES is deployed on the customer domain or not.
 */
export class AccountServer extends Api {

  constructor(private acctEmail: string) {
    super();
  }

  public loginWithOpenid = async (acctEmail: string, uuid: string, idToken: string): Promise<void> => {
    if (await this.isFesUsed()) {
      // FES doesn't issue any access tokens
    } else {
      await FlowCryptComApi.loginWithOpenid(acctEmail, uuid, idToken);
    }
  };

  public accountGetAndUpdateLocalStore = async (fcAuth: FcUuidAuth): Promise<BackendRes.FcAccountGet> => {
    if (await this.isFesUsed()) {
      const fes = new EnterpriseServer(this.acctEmail);
      const fetchedClientConfiguration = await fes.fetchAndSaveClientConfiguration();
      return {
        domain_org_rules: fetchedClientConfiguration,
        // todo - rethink this. On FES, expiration is handled with S3 bucket policy regardless of this number
        //  which is set to 180 days on buckets we manage. This number below may still be rendered somewhere
        //  when composing, which should be evaluated.
        account: { default_message_expire: 180 }
      };
    } else {
      return await FlowCryptComApi.accountGetAndUpdateLocalStore(fcAuth);
    }
  };

  public accountUpdate = async (fcAuth: FcUuidAuth, profileUpdate: ProfileUpdate): Promise<void> => {
    if (await this.isFesUsed()) {
      const fes = new EnterpriseServer(this.acctEmail);
      await fes.accountUpdate(profileUpdate);
    } else {
      await FlowCryptComApi.accountUpdate(fcAuth, profileUpdate);
    }
  };

  public messageUpload = async (
    fcAuth: FcUuidAuth | undefined,
    encrypted: Uint8Array,
    replyToken: string,
    from: string,
    recipients: ParsedRecipients,
    progressCb: ProgressCb
  ): Promise<UploadedMessageData> => {
    if (await this.isFesUsed()) {
      const fes = new EnterpriseServer(this.acctEmail);
      // Recipients are used to later cross-check replies from the web
      //   The message is not actually sent to them now.
      //   Message is uploaded and a link is retrieved which is sent through Gmail.
      return await fes.webPortalMessageUpload(encrypted, replyToken, from, recipients, progressCb);
    } else {
      return await FlowCryptComApi.messageUpload(fcAuth, encrypted, progressCb);
    }
  };

  public messageGatewayUpdate = async (externalId: string, emailGatewayMessageId: string) => {
    if (await this.isFesUsed()) {
      const fes = new EnterpriseServer(this.acctEmail);
      await fes.messageGatewayUpdate(externalId, emailGatewayMessageId);
    }
  };

  public messageToken = async (fcAuth: FcUuidAuth): Promise<{ replyToken: string }> => {
    if (await this.isFesUsed()) {
      const fes = new EnterpriseServer(this.acctEmail);
      return await fes.webPortalMessageNewReplyToken();
    } else {
      const res = await FlowCryptComApi.messageToken(fcAuth);
      return { replyToken: res.token };
    }
  };

  public isFesUsed = async (): Promise<boolean> => {
    return await isFesUsed(this.acctEmail);
  };
}
