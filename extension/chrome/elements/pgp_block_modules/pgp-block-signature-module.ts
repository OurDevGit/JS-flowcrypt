/* ©️ 2016 - present FlowCrypt a.s. Limitations apply. Contact human@flowcrypt.com */

'use strict';

import { ApiErr } from '../../../js/common/api/shared/api-error.js';
import { Catch } from '../../../js/common/platform/catch.js';
import { PgpBlockView } from '../pgp_block';
import { Ui } from '../../../js/common/browser/ui.js';
import { VerifyRes } from '../../../js/common/core/crypto/pgp/msg-util.js';
import { Value } from '../../../js/common/core/common.js';
import { BrowserMsg } from '../../../js/common/browser/browser-msg.js';

export class PgpBlockViewSignatureModule {

  constructor(private view: PgpBlockView) {
  }

  public renderPgpSignatureCheckResult = async (
    verifyRes: VerifyRes | undefined,
    verificationPubs: string[],
    retryVerification?: (verificationPubs: string[]) => Promise<VerifyRes | undefined>
  ) => {
    this.view.renderModule.doNotSetStateAsReadyYet = true; // so that body state is not marked as ready too soon - automated tests need to know when to check results
    if (verifyRes?.error) {
      if (this.view.signature && !verifyRes.isErrFatal && this.view.decryptModule.canAndShouldFetchFromApi()) {
        // Sometimes the signed content is slightly modified when parsed from DOM,
        // so the message should be re-fetched straight from API to make sure we get the original signed data and verify again
        this.view.signature.parsedSignature = undefined; // force to re-parse
        await this.view.decryptModule.initialize(verificationPubs, true);
        return;
      }
      this.view.renderModule.renderSignatureStatus(`error verifying signature: ${verifyRes.error}`);
      this.view.renderModule.setFrameColor('red');
    } else if (!verifyRes || !verifyRes.signerLongids.length) {
      this.view.renderModule.renderSignatureStatus('not signed');
    } else if (verifyRes.match) {
      this.view.renderModule.renderSignatureStatus('signed');
    } else {
      if (retryVerification) {
        const signerEmail = this.view.getExpectedSignerEmail();
        if (!signerEmail) {
          // in some tests we load the block without sender information
          this.view.renderModule.renderSignatureStatus('could not verify signature: missing pubkey, missing sender info');
        } else {
          $('#pgp_signature').addClass('gray_label').text('verifying signature...');
          try {
            const { pubkeys } = await this.view.pubLookup.lookupEmail(signerEmail);
            if (pubkeys.length) {
              await BrowserMsg.send.bg.await.saveFetchedPubkeys({ email: signerEmail, pubkeys });
              await this.renderPgpSignatureCheckResult(await retryVerification(pubkeys), pubkeys, undefined);
              return;
            }
            this.renderMissingPubkeyOrBadSignature(verifyRes);
          } catch (e) {
            if (ApiErr.isSignificant(e)) {
              Catch.reportErr(e);
              this.view.renderModule.renderSignatureStatus(`error verifying signature: ${e}`);
            } else {
              this.view.renderModule.renderSignatureStatus('error verifying signature: offline, click to retry').on('click',
                this.view.setHandler(() => window.location.reload()));
            }
          }
        }
      } else { // !retryVerification
        this.renderMissingPubkeyOrBadSignature(verifyRes);
      }
    }
    this.view.renderModule.doNotSetStateAsReadyYet = false;
    Ui.setTestState('ready');
  };

  private renderMissingPubkey = (signerLongid: string) => {
    this.view.renderModule.renderSignatureStatus(`could not verify signature: missing pubkey ${signerLongid}`);
  };

  private renderBadSignature = () => {
    this.view.renderModule.renderSignatureStatus('bad signature');
    this.view.renderModule.setFrameColor('red'); // todo: in what other cases should we set the frame red?
  };

  private renderMissingPubkeyOrBadSignature = (verifyRes: VerifyRes): void => {
    if (verifyRes.match === null || !Value.arr.hasIntersection(verifyRes.signerLongids, verifyRes.suppliedLongids)) {
      this.renderMissingPubkey(verifyRes.signerLongids[0]);
    } else {
      this.renderBadSignature();
    }
  };
}
