/* © 2016-2018 FlowCrypt Limited. Limitations apply. Contact human@flowcrypt.com */

'use strict';

import { Pgp } from '../../js/common/pgp.js';
import { Env } from '../../js/common/browser.js';
import { StandardError } from '../../js/common/common.js';

(() => {

  let urlParams = Env.urlParams(['f', 'args']);
  let f = String(urlParams.f);
  let args = JSON.parse(String(urlParams.args));

  let test = (method: Function, arg: any[]) => { // tslint:disable-line:ban-types
    try {
      return finish(null, method.apply(null, arg));
    } catch (e) {
      return finish(e);
    }
  };

  let finish = (error: string | StandardError | Error | null, result?: any) => {
    error = (error === null) ? null : String(error);
    $('#result').text(JSON.stringify({ error, result }));
    $('#result').attr('data-test-state', 'ready');
  };

  if (f === 'Pgp.armor.detectBlocks' && args.length === 1 && typeof args[0] === 'string') {
    return test(Pgp.armor.detectBlocks, args);
  } else {
    return finish('Unknown unit test f');
  }

})();
