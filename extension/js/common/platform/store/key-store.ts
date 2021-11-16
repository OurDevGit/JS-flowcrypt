/* ©️ 2016 - present FlowCrypt a.s. Limitations apply. Contact human@flowcrypt.com */

import { KeyInfo, TypedKeyInfo, ExtendedKeyInfo, KeyUtil, Key, KeyIdentity } from '../../core/crypto/key.js';
import { AcctStore } from './acct-store.js';
import { PassphraseStore } from './passphrase-store.js';
import { AbstractStore } from './abstract-store.js';
import { Assert } from '../../assert.js';

/**
 * Local store of account private keys
 */
export class KeyStore extends AbstractStore {

  public static get = async (acctEmail: string, fingerprints?: string[]): Promise<KeyInfo[]> => {
    const stored = await AcctStore.get(acctEmail, ['keys']);
    const keys: KeyInfo[] = stored.keys || [];
    if (!fingerprints) {
      return keys;
    }
    // filters by primary fingerprint - subkey fingerprints are ignored
    // todo - could consider also filtering by subkey fingerprints, but need to think about impact
    return keys.filter(ki => fingerprints.includes(ki.fingerprints[0]));
  };

  public static getFirstOptional = async (acctEmail: string): Promise<KeyInfo | undefined> => {
    const keys = await KeyStore.get(acctEmail);
    return keys[0];
  };

  public static getFirstRequired = async (acctEmail: string): Promise<KeyInfo> => {
    const key = await KeyStore.getFirstOptional(acctEmail);
    Assert.abortAndRenderErrorIfKeyinfoEmpty(key);
    return key as KeyInfo;
  };

  public static getTypedKeyInfos = async (acctEmail: string): Promise<TypedKeyInfo[]> => {
    const keys = await KeyStore.get(acctEmail);
    const kis: TypedKeyInfo[] = [];
    for (const ki of keys) {
      const type = KeyUtil.getKeyType(ki.private);
      const id = ki.fingerprints[0];
      if (type !== 'openpgp' && type !== 'x509') {
        continue;
      }
      kis.push({ ...ki, type, id });
    }
    return kis;
  };

  public static getAllWithOptionalPassPhrase = async (acctEmail: string): Promise<ExtendedKeyInfo[]> => {
    const keys = await KeyStore.getTypedKeyInfos(acctEmail);
    return await Promise.all(keys.map(async (ki) => { return { ...ki, passphrase: await PassphraseStore.get(acctEmail, ki) }; }));
  };

  public static add = async (acctEmail: string, newKey: string | Key) => {
    const keyinfos = await KeyStore.get(acctEmail);
    let updated = false;
    const prv: Key = (typeof newKey === 'string') ? await KeyUtil.parse(newKey) : newKey;
    if (!prv.fullyEncrypted) {
      throw new Error('Cannot import plain, unprotected key.');
    }
    for (const i in keyinfos) {
      if (prv.id === keyinfos[i].fingerprints[0]) { // replacing a key
        keyinfos[i] = await KeyUtil.keyInfoObj(prv);
        updated = true;
      }
    }
    if (!updated) {
      keyinfos.push(await KeyUtil.keyInfoObj(prv));
    }
    await KeyStore.set(acctEmail, keyinfos);
  };

  public static set = async (acctEmail: string, keyinfos: KeyInfo[]) => {
    await AcctStore.set(acctEmail, { keys: keyinfos });
  };

  public static remove = async (acctEmail: string, keyIdentity: KeyIdentity): Promise<void> => {
    const privateKeys = await KeyStore.getTypedKeyInfos(acctEmail);
    const filteredPrivateKeys = privateKeys.filter(ki => !KeyUtil.identityEquals(ki, keyIdentity));
    await KeyStore.set(acctEmail, filteredPrivateKeys);
  };

  public static getKeyInfosThatCurrentlyHavePassPhraseInSession = async (acctEmail: string): Promise<TypedKeyInfo[]> => {
    const keys = await KeyStore.getTypedKeyInfos(acctEmail);
    const result: TypedKeyInfo[] = [];
    for (const ki of keys) {
      if (! await PassphraseStore.get(acctEmail, ki, true) && await PassphraseStore.get(acctEmail, ki, false)) {
        result.push(ki);
      }
    }
    return result;
  };
}
