/* ©️ 2016 - present FlowCrypt a.s. Limitations apply. Contact human@flowcrypt.com */

'use strict';

import { Lang } from '../../../js/common/lang.js';
import { ViewModule } from '../../../js/common/view-module.js';
import { BackupView } from './backup.js';
import { Settings } from '../../../js/common/settings.js';
import { UnreportableError } from '../../../js/common/platform/catch.js';
import { Ui } from '../../../js/common/browser/ui.js';
import { ApiErr } from '../../../js/common/api/shared/api-error.js';
import { GoogleAuth } from '../../../js/common/api/email-provider/gmail/google-auth.js';
import { KeyStore } from '../../../js/common/platform/store/key-store.js';
import { KeyStoreUtil } from "../../../js/common/core/crypto/key-store-util.js";

export class BackupAutomaticModule extends ViewModule<BackupView> {

  public simpleSetupAutoBackupRetryUntilSuccessful = async () => {
    try {
      await this.setupCreateSimpleAutomaticInboxBackup();
    } catch (e) {
      return await Settings.promptToRetry(e, Lang.setup.failedToBackUpKey, this.setupCreateSimpleAutomaticInboxBackup,
        Lang.general.contactIfNeedAssistance(!!this.view.fesUrl));
    }
  };

  private setupCreateSimpleAutomaticInboxBackup = async () => {
    const prvs = await KeyStoreUtil.parse(await KeyStore.getRequired(this.view.acctEmail));
    if (prvs.find(prv => !prv.key.fullyEncrypted)) {
      await Ui.modal.warning('Key not protected with a pass phrase, skipping');
      throw new UnreportableError('Key not protected with a pass phrase, skipping');
    }
    try {
      await this.view.manualModule.doBackupOnEmailProvider(prvs.map(prv => prv.keyInfo));
      await this.view.renderBackupDone(1);
    } catch (e) {
      if (ApiErr.isAuthErr(e)) {
        await Ui.modal.info("Authorization Error. FlowCrypt needs to reconnect your Gmail account");
        const connectResult = await GoogleAuth.newAuthPopup({ acctEmail: this.view.acctEmail });
        if (!connectResult.error) {
          await this.setupCreateSimpleAutomaticInboxBackup();
        } else {
          throw e;
        }
      }
    }
  };

}
