/* ©️ 2016 - present FlowCrypt a.s. Limitations apply. Contact human@flowcrypt.com */
import { Key, PrvPacket, KeyAlgo, KeyUtil, UnexpectedKeyTypeError, PubkeyInfo } from '../key.js';
import { opgp } from './openpgpjs-custom.js';
import { Catch } from '../../../platform/catch.js';
import { Str, Value } from '../../common.js';
import { Buf } from '../../buf.js';
import { PgpMsgMethod, VerifyRes } from './msg-util.js';

type OpenpgpMsgOrCleartext = OpenPGP.message.Message | OpenPGP.cleartext.CleartextMessage;

export class OpenPGPKey {
  private static readonly encryptionText = 'This is the text we are encrypting!';

  // mapping of algo names to required param count, lazy initialized
  private static paramCountByAlgo: { [key: string]: number };

  // mapping of algo names to required bits, lazy initialized
  private static minimumBitsByAlgo: { [key: string]: number };

  public static parse = async (text: string): Promise<Key> => {
    const keys = await OpenPGPKey.parseMany(text);
    const keysLength = keys.length;
    if (keysLength > 1) {
      throw new Error(`Found ${keysLength} OpenPGP keys, expected one`);
    }
    return keys[0];
  };

  public static parseMany = async (text: string): Promise<Key[]> => {
    const result = await opgp.key.readArmored(text);
    if (result.err) {
      throw new Error('Cannot parse OpenPGP key: ' + result.err + ' for: ' + text);
    }
    const keys = [];
    for (const key of result.keys) {
      await OpenPGPKey.validateAllDecryptedPackets(key);
      keys.push(await OpenPGPKey.convertExternalLibraryObjToKey(key));
    }
    return keys;
  };

  public static validateAllDecryptedPackets = async (key: OpenPGP.key.Key): Promise<void> => {
    const decryptedPackets = key
      .toPacketlist()
      .filter(OpenPGPKey.isPacketPrivate)
      .filter(packet => packet.isDecrypted());
    for (const prvPacket of decryptedPackets) {
      await prvPacket.validate(); // gnu-dummy never raises an exception, invalid keys raise exceptions
    }
  };

  public static asPublicKey = async (pubkey: Key): Promise<Key> => {
    if (pubkey.family !== 'openpgp') {
      throw new UnexpectedKeyTypeError(`Key type is ${pubkey.family}, expecting OpenPGP`);
    }
    if (pubkey.isPrivate) {
      return await OpenPGPKey.convertExternalLibraryObjToKey(OpenPGPKey.extractStrengthUncheckedExternalLibraryObjFromKey(pubkey).toPublic());
    }
    return pubkey;
  };

  public static decryptKey = async (
    key: Key,
    passphrase: string,
    optionalKeyid?: OpenPGP.Keyid,
    optionalBehaviorFlag?: 'OK-IF-ALREADY-DECRYPTED'
  ): Promise<boolean> => {
    const prv = OpenPGPKey.extractExternalLibraryObjFromKey(key);
    if (!prv.isPrivate()) {
      throw new Error('Nothing to decrypt in a public key');
    }
    const chosenPrvPackets = prv
      .getKeys(optionalKeyid)
      .map(k => k.keyPacket)
      .filter(OpenPGPKey.isPacketPrivate) as PrvPacket[];
    if (!chosenPrvPackets.length) {
      const availablePackets = prv
        .getKeys()
        .map(k => k.keyPacket)
        .filter(OpenPGPKey.isPacketPrivate);
      throw new Error(`No private key packets selected of ${availablePackets.length} prv packets available`);
    }
    for (const prvPacket of chosenPrvPackets) {
      if (prvPacket.isDecrypted()) {
        if (optionalBehaviorFlag === 'OK-IF-ALREADY-DECRYPTED') {
          continue;
        } else {
          throw new Error('Decryption failed - key packet was already decrypted');
        }
      }
      try {
        await prvPacket.decrypt(passphrase); // throws on password mismatch
        await prvPacket.validate(); // throws
      } catch (e) {
        if (e instanceof Error && e.message.toLowerCase().includes('incorrect key passphrase')) {
          return false;
        }
        throw e;
      }
    }
    await OpenPGPKey.convertExternalLibraryObjToKey(prv, key);
    return true;
  };

  public static encryptKey = async (key: Key, passphrase: string) => {
    const prv = OpenPGPKey.extractExternalLibraryObjFromKey(key);
    if (!passphrase || passphrase === 'undefined' || passphrase === 'null') {
      throw new Error(`Encryption passphrase should not be empty:${typeof passphrase}:${passphrase}`);
    }
    const secretPackets = prv
      .getKeys()
      .map(k => k.keyPacket)
      .filter(OpenPGPKey.isPacketPrivate);
    const encryptedPacketCount = secretPackets.filter(p => !p.isDecrypted()).length;
    if (!secretPackets.length) {
      throw new Error(`No private key packets in key to encrypt. Is this a private key?`);
    }
    if (encryptedPacketCount) {
      throw new Error(`Cannot encrypt a key that has ${encryptedPacketCount} of ${secretPackets.length} private packets still encrypted`);
    }
    await prv.encrypt(passphrase);
    if (!prv.isFullyEncrypted()) {
      throw new Error('Expected key to be fully encrypted after prv.encrypt');
    }
    await OpenPGPKey.convertExternalLibraryObjToKey(prv, key);
  };

  public static decryptMessage = async (message: OpenPGP.message.Message, privateKeys: Key[], passwords?: string[]) => {
    return await message.decrypt(
      privateKeys.map(key => OpenPGPKey.extractExternalLibraryObjFromKey(key)),
      passwords,
      undefined,
      false
    );
  };

  public static encryptMessage: PgpMsgMethod.Encrypt = async ({ pubkeys, signingPrv, pwd, data, filename, armor, date }) => {
    const message = opgp.message.fromBinary(data, filename, date);
    const options: OpenPGP.EncryptOptions = { armor, message, date };
    if (pubkeys) {
      options.publicKeys = [];
      for (const pubkey of pubkeys) {
        const { keys: publicKeys } = await opgp.key.readArmored(KeyUtil.armor(pubkey));
        options.publicKeys.push(...publicKeys);
        // TODO: Investigate why unwrapping doesn't work - probably the object
        // came from the background page so it wasn't properly deserialized
        // options.publicKeys.push(OpenPGPKey.unwrap(pubkey));
      }
    }
    if (pwd) {
      options.passwords = [pwd];
    }
    if (!pubkeys && !pwd) {
      throw new Error('no-pubkeys-no-challenge');
    }
    if (signingPrv) {
      const openPgpPrv = OpenPGPKey.extractExternalLibraryObjFromKey(signingPrv);
      if (typeof openPgpPrv.isPrivate !== 'undefined' && openPgpPrv.isPrivate()) {
        options.privateKeys = [openPgpPrv];
      }
    }
    const result = await opgp.encrypt(options);
    if (typeof result.data === 'string') {
      return { data: Buf.fromUtfStr(result.data), signature: result.signature, type: 'openpgp' };
    } else {
      return result as unknown as OpenPGP.EncryptBinaryResult;
    }
  };

  public static isWithoutSelfCertifications = async (key: Key) => {
    const opgpPrv = OpenPGPKey.extractExternalLibraryObjFromKey(key);
    return await Catch.doesReject(opgpPrv.verifyPrimaryKey(), ['No self-certifications']);
  };

  public static reformatKey = async (
    privateKey: Key,
    passphrase: string | undefined,
    userIds: { email: string | undefined; name: string }[],
    expireSeconds: number
  ) => {
    const opgpPrv = OpenPGPKey.extractExternalLibraryObjFromKey(privateKey);
    const keyPair = await opgp.reformatKey({
      privateKey: opgpPrv,
      passphrase,
      userIds,
      keyExpirationTime: expireSeconds,
    });
    return await OpenPGPKey.convertExternalLibraryObjToKey(keyPair.key);
  };

  /**
   * TODO: should be private, will change when readMany is rewritten
   * @param opgpKey - original OpenPGP.js key
   * @param keyToUpdate - an existing Key object to update, optional. Useful in encryptKey and decryptKey, because the operation
   *    is done on the original supplied object.
   */
  public static convertExternalLibraryObjToKey = async (opgpKey: OpenPGP.key.Key, keyToUpdate?: Key): Promise<Key> => {
    const { isPrimaryKeyStrong, keyWithoutWeakPackets } = OpenPGPKey.removeWeakKeyPackets(opgpKey);
    let exp: null | Date | number;
    try {
      exp = await keyWithoutWeakPackets.getExpirationTime('encrypt');
    } catch (e) {
      // eslint-disable-next-line no-null/no-null
      exp = null;
    }
    const expired = () => {
      if (exp === Infinity || !exp) {
        return false;
      }
      // According to the documentation expiration is either undefined, Infinity
      // (typeof number) or a Date object. So in this case `exp` should never
      // be of type number.
      if (typeof exp === 'number') {
        throw new Error(`Got unexpected value for expiration: ${exp}`);
      }
      return Date.now() > exp.getTime();
    };
    const identities = await OpenPGPKey.getSortedUserids(keyWithoutWeakPackets);
    const emails = identities
      .map(userid => {
        try {
          return opgp.util.parseUserId(userid).email || '';
        } catch (e) {
          // ignore bad user IDs
        }
        return '';
      })
      .map(email => email.trim())
      .filter(email => email)
      .map(email => email.toLowerCase());
    let lastModified: undefined | number;
    try {
      lastModified = await OpenPGPKey.getLastSigTime(keyWithoutWeakPackets);
    } catch (e) {
      // never had any valid signature
    }
    const fingerprint = keyWithoutWeakPackets.getFingerprint();
    if (!fingerprint) {
      throw new Error('Key does not have a fingerprint and cannot be parsed.');
    }
    const algoInfo = keyWithoutWeakPackets.primaryKey.getAlgorithmInfo();
    const key = keyToUpdate || ({} as Key); // if no key to update, use empty object, will get props assigned below

    const {
      encryptionKey = undefined,
      encryptionKeyIgnoringExpiration = undefined,
      signingKey = undefined,
      signingKeyIgnoringExpiration = undefined,
    } = isPrimaryKeyStrong ? await OpenPGPKey.getSigningAndEncryptionKeys(keyWithoutWeakPackets, exp, expired) : {};
    const missingPrivateKeyForSigning = signingKeyIgnoringExpiration?.keyPacket
      ? OpenPGPKey.arePrivateParamsMissing(signingKeyIgnoringExpiration.keyPacket)
      : false;
    const missingPrivateKeyForDecryption = encryptionKeyIgnoringExpiration?.keyPacket
      ? OpenPGPKey.arePrivateParamsMissing(encryptionKeyIgnoringExpiration.keyPacket)
      : false;
    Object.assign(key, {
      family: 'openpgp',
      id: fingerprint.toUpperCase(),
      allIds: keyWithoutWeakPackets.getKeys().map(k => k.getFingerprint().toUpperCase()),
      usableForEncryption: encryptionKey ? true : false,
      usableForEncryptionButExpired: !encryptionKey && !!encryptionKeyIgnoringExpiration,
      usableForSigning: signingKey ? true : false,
      usableForSigningButExpired: !signingKey && !!signingKeyIgnoringExpiration,
      missingPrivateKeyForSigning,
      missingPrivateKeyForDecryption,
      // valid emails extracted from uids
      emails,
      // full uids that have valid emails in them

      identities,
      lastModified,
      expiration: exp instanceof Date ? exp.getTime() : undefined,
      created: keyWithoutWeakPackets.getCreationTime().getTime(),
      fullyDecrypted: keyWithoutWeakPackets.isPublic() ? true /* public keys are always decrypted */ : keyWithoutWeakPackets.isFullyDecrypted(),
      fullyEncrypted: keyWithoutWeakPackets.isPublic() ? false /* public keys are never encrypted */ : keyWithoutWeakPackets.isFullyEncrypted(),
      isPublic: keyWithoutWeakPackets.isPublic(),
      isPrivate: keyWithoutWeakPackets.isPrivate(),
      algo: {
        algorithm: algoInfo.algorithm,
        bits: algoInfo.bits,
        curve: (algoInfo as unknown as { curve: string | undefined }).curve,
        algorithmId: opgp.enums.publicKey[algoInfo.algorithm],
      },
      revoked: keyWithoutWeakPackets.revocationSignatures.length > 0,
    } as Key);
    (key as Key & { internal: OpenPGP.key.Key }).internal = keyWithoutWeakPackets;
    (key as Key & { rawKey: OpenPGP.key.Key }).rawKey = opgpKey;
    (key as Key & { rawArmored: string }).rawArmored = opgpKey.armor();
    return key;
  };

  /**
   * Returns signed data if detached=false, armored
   * Returns signature if detached=true, armored
   */
  public static sign = async (signingPrivate: Key, data: string, detached = false): Promise<string> => {
    const signingPrv = OpenPGPKey.extractExternalLibraryObjFromKey(signingPrivate);
    const message = opgp.cleartext.fromText(data);
    const signRes = await opgp.sign({ message, armor: true, privateKeys: [signingPrv], detached });
    if (detached) {
      if (typeof signRes.signature !== 'string') {
        throw new Error('signRes.signature unexpectedly not a string when creating detached signature');
      }
      return signRes.signature;
    }
    return await opgp.stream.readToEnd((signRes as OpenPGP.SignArmorResult).data);
  };

  public static revoke = async (key: Key): Promise<string | undefined> => {
    let prv = OpenPGPKey.extractExternalLibraryObjFromKey(key);
    if (!(await prv.isRevoked())) {
      prv = await prv.revoke({});
    }
    const certificate = await prv.getRevocationCertificate();
    if (!certificate) {
      return undefined;
    } else if (typeof certificate === 'string') {
      return certificate;
    } else {
      return await opgp.stream.readToEnd(certificate);
    }
  };

  public static keyFlagsToString = (flags: OpenPGP.enums.keyFlags): string => {
    const strs: string[] = [];
    if (flags & opgp.enums.keyFlags.encrypt_communication) {
      strs.push('encrypt_communication');
    }
    if (flags & opgp.enums.keyFlags.encrypt_storage) {
      strs.push('encrypt_storage');
    }
    if (flags & opgp.enums.keyFlags.sign_data) {
      strs.push('sign_data');
    }
    if (flags & opgp.enums.keyFlags.certify_keys) {
      strs.push('certify_keys');
    }
    return '[' + strs.join(', ') + ']';
  };

  public static diagnose = async (pubkey: Key, passphrase: string): Promise<Map<string, string>> => {
    const key = OpenPGPKey.extractExternalLibraryObjFromKey(pubkey);
    const result = new Map<string, string>();
    if (!key.isPrivate() && !key.isPublic()) {
      result.set(`key is neither public or private!!`, '');
      return result;
    }
    result.set(`Is Private?`, KeyUtil.formatResult(key.isPrivate()));
    for (let i = 0; i < key.users.length; i++) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      result.set(`User id ${i}`, key.users[i].userId!.userid);
    }
    const user = await key.getPrimaryUser();
    result.set(`Primary User`, user?.user?.userId?.userid || 'No primary user');
    result.set(`Fingerprint`, Str.spaced(key.getFingerprint().toUpperCase() || 'err'));
    // take subkeys from original key so we show subkeys disabled by #2715 too
    const subKeys = OpenPGPKey.extractStrengthUncheckedExternalLibraryObjFromKey(pubkey)?.subKeys ?? key.subKeys;
    result.set(`Subkeys`, KeyUtil.formatResult(subKeys ? subKeys.length : subKeys));
    result.set(`Primary key algo`, KeyUtil.formatResult(key.primaryKey.algorithm));
    const flags = await OpenPGPKey.getPrimaryKeyFlags(key);
    result.set(`Usage flags`, KeyUtil.formatResult(OpenPGPKey.keyFlagsToString(flags)));
    if (key.isPrivate() && !key.isFullyDecrypted()) {
      result.set(
        `key decrypt`,
        await KeyUtil.formatResultAsync(async () => {
          try {
            await key.decrypt(passphrase); // throws on password mismatch
            return 'success';
          } catch (e) {
            if (e instanceof Error && e.message.toLowerCase().includes('incorrect key passphrase')) {
              return 'INCORRECT PASSPHRASE';
            } else {
              throw e;
            }
          }
        })
      );
      result.set(`isFullyDecrypted`, KeyUtil.formatResult(key.isFullyDecrypted()));
      result.set(`isFullyEncrypted`, KeyUtil.formatResult(key.isFullyEncrypted()));
    }
    result.set(
      `Primary key verify`,
      await KeyUtil.formatResultAsync(async () => {
        await key.verifyPrimaryKey(); // throws
        return `valid`;
      })
    );
    result.set(`Primary key creation?`, await KeyUtil.formatResultAsync(async () => OpenPGPKey.formatDate(await key.getCreationTime())));
    result.set(`Primary key expiration?`, await KeyUtil.formatResultAsync(async () => OpenPGPKey.formatDate(await key.getExpirationTime())));
    const encryptResult = await OpenPGPKey.testEncryptDecrypt(key);
    await Promise.all(encryptResult.map(msg => result.set(`Encrypt/Decrypt test: ${msg}`, '')));
    if (key.isPrivate()) {
      result.set(`Sign/Verify test`, await KeyUtil.formatResultAsync(async () => await OpenPGPKey.testSignVerify(key)));
    }
    for (let subKeyIndex = 0; subKeyIndex < subKeys.length; subKeyIndex++) {
      const subKey = subKeys[subKeyIndex];
      const skn = `SK ${subKeyIndex} >`;
      result.set(`${skn} LongId`, await KeyUtil.formatResultAsync(async () => OpenPGPKey.bytesToLongid(subKey.getKeyId().bytes)));
      result.set(`${skn} Created`, await KeyUtil.formatResultAsync(async () => OpenPGPKey.formatDate(subKey.keyPacket.created)));
      result.set(`${skn} Algo`, await KeyUtil.formatResultAsync(async () => `${subKey.getAlgorithmInfo().algorithm}`));
      const flags = (await OpenPGPKey.getSubKeySigningFlags(key, subKey)) | (await OpenPGPKey.getSubKeyEncryptionFlags(key, subKey));
      result.set(`${skn} Usage flags`, KeyUtil.formatResult(OpenPGPKey.keyFlagsToString(flags)));
      result.set(
        `${skn} Verify`,
        await KeyUtil.formatResultAsync(async () => {
          await subKey.verify(key.primaryKey);
          return 'OK';
        })
      );
      result.set(`${skn} Subkey tag`, await KeyUtil.formatResultAsync(async () => subKey.keyPacket.tag));
      result.set(`${skn} Subkey getBitSize`, await KeyUtil.formatResultAsync(async () => subKey.getAlgorithmInfo().bits)); // No longer exists on object
      result.set(`${skn} Subkey decrypted`, KeyUtil.formatResult(subKey.isDecrypted()));
      result.set(`${skn} Binding signature length`, await KeyUtil.formatResultAsync(async () => subKey.bindingSignatures.length));
      for (let sigIndex = 0; sigIndex < subKey.bindingSignatures.length; sigIndex++) {
        const sig = subKey.bindingSignatures[sigIndex];
        const sgn = `${skn} SIG ${sigIndex} >`;
        result.set(`${sgn} Key flags`, await KeyUtil.formatResultAsync(async () => sig.keyFlags));
        result.set(`${sgn} Tag`, await KeyUtil.formatResultAsync(async () => sig.tag));
        result.set(`${sgn} Version`, await KeyUtil.formatResultAsync(async () => sig.version));
        result.set(`${sgn} Public key algorithm`, await KeyUtil.formatResultAsync(async () => sig.publicKeyAlgorithm));
        result.set(`${sgn} Sig creation time`, KeyUtil.formatResult(OpenPGPKey.formatDate(sig.created)));
        result.set(
          `${sgn} Sig expiration time`,
          await KeyUtil.formatResultAsync(async () => {
            if (!subKey.keyPacket.created) {
              return 'unknown key creation time';
            }
            return OpenPGPKey.formatDate(subKey.keyPacket.created, sig.keyExpirationTime);
          })
        );
        result.set(`${sgn} Verified`, KeyUtil.formatResult(sig.verified));
      }
    }
    return result;
  };

  public static bytesToLongid = (binaryString: string) => {
    if (binaryString.length !== 8) {
      throw new Error(`Unexpected keyid bytes format (len: ${binaryString.length}): "${binaryString}"`);
    }
    return opgp.util.str_to_hex(binaryString).toUpperCase();
  };

  public static fingerprintToLongid = (fingerprint: string) => {
    if (fingerprint.length === 40) {
      // pgp keys
      return fingerprint.substr(-16).toUpperCase();
    }
    throw new Error(`Unexpected fingerprint format (len: ${fingerprint.length}): "${fingerprint}"`);
  };

  /**
   * todo - could return a Key
   */
  public static create = async (
    userIds: { name: string; email: string }[],
    variant: KeyAlgo,
    passphrase: string,
    expireInMonths: number | undefined
  ): Promise<{ private: string; public: string }> => {
    const opt: OpenPGP.KeyOptions = { userIds, passphrase };
    if (variant === 'curve25519') {
      opt.curve = 'curve25519';
    } else if (variant === 'rsa2048') {
      opt.numBits = 2048;
    } else if (variant === 'rsa3072') {
      opt.numBits = 3072;
    } else {
      opt.numBits = 4096;
    }
    if (expireInMonths) {
      opt.keyExpirationTime = 60 * 60 * 24 * 30 * expireInMonths; // seconds from now
    }
    const k = await opgp.generateKey(opt);
    return { public: k.publicKeyArmored, private: k.privateKeyArmored };
  };

  public static isPacketPrivate = (p: OpenPGP.packet.BasePacket): p is PrvPacket => {
    return p.tag === opgp.enums.packet.secretKey || p.tag === opgp.enums.packet.secretSubkey;
  };

  public static isBaseKeyPacket = (p: OpenPGP.packet.BasePacket): p is OpenPGP.packet.BaseKeyPacket => {
    return [opgp.enums.packet.secretKey, opgp.enums.packet.secretSubkey, opgp.enums.packet.publicKey, opgp.enums.packet.publicSubkey].includes(p.tag);
  };

  public static isPacketDecrypted = (pubkey: Key, keyid: OpenPGP.Keyid) => {
    return OpenPGPKey.extractExternalLibraryObjFromKey(pubkey).isPacketDecrypted(keyid);
  };

  public static getPrimaryUserId = async (pubs: OpenPGP.key.Key[], keyid: OpenPGP.Keyid): Promise<string | undefined> => {
    for (const opgpkey of pubs) {
      const matchingKeys = await opgpkey.getKeys(keyid);
      if (matchingKeys.length > 0) {
        const primaryUser = await opgpkey.getPrimaryUser();
        return primaryUser?.user?.userId?.userid;
      }
    }
    return undefined;
  };

  public static verify = async (msg: OpenpgpMsgOrCleartext, pubs: PubkeyInfo[]): Promise<VerifyRes> => {
    // todo: double-check if S/MIME ever gets here
    const validKeys = pubs.filter(x => !x.revoked && x.pubkey.family === 'openpgp').map(x => x.pubkey);
    // todo: #4172 revoked longid may result in incorrect "Missing pubkey..." output
    const verifyRes: VerifyRes = {
      match: null, // eslint-disable-line no-null/no-null
      signerLongids: [],
      signerFingerprints: [],
      suppliedLongids: validKeys.map(x => x.allIds.map(fp => OpenPGPKey.fingerprintToLongid(fp))).reduce((a, b) => a.concat(b), []),
    };
    const opgpKeys = validKeys.map(x => OpenPGPKey.extractExternalLibraryObjFromKey(x));
    // todo: expired?
    try {
      // this is here to ensure execution order when 1) verify, 2) read data, 3) processing signatures
      // Else it will hang trying to read a stream: https://github.com/openpgpjs/openpgpjs/issues/916#issuecomment-510620625
      const verifications = await msg.verify(opgpKeys); // first step
      const stream = msg instanceof opgp.message.Message ? msg.getLiteralData() : msg.getText();
      if (stream) {
        // encrypted message
        const data = await opgp.stream.readToEnd(stream); // second step
        verifyRes.content = data instanceof Uint8Array ? new Buf(data) : Buf.fromUtfStr(data);
      }
      // third step below
      const signerLongids: string[] = [];
      const fingerprints: string[] = [];
      for (const verification of verifications) {
        // todo - a valid signature is a valid signature, and should be surfaced. Currently, if any of the signatures are not valid, it's showing all as invalid
        // .. as it is now this could allow an attacker to append bogus signatures to validly signed messages, making otherwise correct messages seem incorrect
        // .. which is not really an issue - an attacker that can append signatures could have also just slightly changed the message, causing the same experience
        // .. so for now #wontfix unless a reasonable usecase surfaces
        // eslint-disable-next-line no-null/no-null
        verifyRes.match = (verifyRes.match === true || verifyRes.match === null) && (await verification.verified);
        const signature = await verification.signature;
        fingerprints.push(
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          ...signature.packets.filter(s => s.issuerFingerprint).map(s => Buf.fromUint8(s.issuerFingerprint!).toHexStr())
        );
        signerLongids.push(OpenPGPKey.bytesToLongid(verification.keyid.bytes));
      }
      verifyRes.signerLongids = Value.arr.unique(signerLongids);
      verifyRes.signerFingerprints = Value.arr.unique(fingerprints);
    } catch (verifyErr) {
      verifyRes.match = null; // eslint-disable-line no-null/no-null
      if (verifyErr instanceof Error && verifyErr.message === 'Can only verify message with one literal data packet.') {
        verifyRes.error = 'FlowCrypt is not equipped to verify this message';
        verifyRes.isErrFatal = true; // don't try to re-fetch the message from API
      } else if (verifyErr instanceof Error && verifyErr.message.startsWith('Insecure message hash algorithm:')) {
        verifyRes.error = `${verifyErr.message}. Sender is using old, insecure OpenPGP software.`;
        verifyRes.isErrFatal = true; // don't try to re-fetch the message from API
      } else if (verifyErr instanceof Error && verifyErr.message === 'Signature is expired') {
        verifyRes.error = verifyErr.message;
        verifyRes.isErrFatal = true; // don't try to re-fetch the message from API
      } else if (verifyErr instanceof Error && verifyErr.message === 'Message digest did not match') {
        verifyRes.error = verifyErr.message;
        verifyRes.match = false;
      } else {
        verifyRes.error = `Error verifying this message: ${String(verifyErr)}`;
        Catch.reportErr(verifyErr);
      }
    }
    return verifyRes;
  };

  private static getSortedUserids = async (key: OpenPGP.key.Key): Promise<string[]> => {
    const data = (
      await Promise.all(
        key.users.filter(Boolean).map(async user => {
          const primaryKey = key.primaryKey;
          const dataToVerify = { userId: user.userId, key: primaryKey };
          const selfCertification = await OpenPGPKey.getLatestValidSignature(
            user.selfCertifications,
            primaryKey,
            opgp.enums.signature.cert_generic,
            dataToVerify
          );
          return { userid: user.userId?.userid, selfCertification };
        })
      )
    ).filter(x => x.selfCertification);
    // sort the same way as OpenPGP.js does
    data.sort((a, b) => {
      /* eslint-disable @typescript-eslint/no-non-null-assertion */
      const A = a.selfCertification!;
      const B = b.selfCertification!;
      /* eslint-enable @typescript-eslint/no-non-null-assertion */
      return Number(A.revoked) - Number(B.revoked) || Number(B.isPrimaryUserID) - Number(A.isPrimaryUserID) || Number(B.created) - Number(A.created);
    });
    return data
      .map(x => x.userid)
      .filter(Boolean)
      .map(y => y!); // eslint-disable-line @typescript-eslint/no-non-null-assertion
  };

  // mimicks OpenPGP.helper.getLatestValidSignature
  private static getLatestValidSignature = async (
    signatures: OpenPGP.packet.Signature[],
    primaryKey: OpenPGP.packet.PublicKey | OpenPGP.packet.SecretKey,
    signatureType: OpenPGP.enums.signature,
    dataToVerify: unknown,
    date = new Date()
  ): Promise<OpenPGP.packet.Signature | undefined> => {
    let signature: OpenPGP.packet.Signature | undefined;
    for (let i = signatures.length - 1; i >= 0; i--) {
      try {
        if (
          (!signature || signatures[i].created >= signature.created) &&
          // check binding signature is not expired (ie, check for V4 expiration time)
          !signatures[i].isExpired(date) &&
          // check binding signature is verified
          (signatures[i].verified || (await signatures[i].verify(primaryKey, signatureType, dataToVerify)))
        ) {
          signature = signatures[i];
        }
      } catch (e) {
        // skip signature with failed verification
      }
    }
    return signature;
  };

  private static getValidEncryptionKeyPacketFlags = (
    keyPacket: OpenPGP.packet.PublicKey | OpenPGP.packet.SecretKey,
    signature: OpenPGP.packet.Signature
  ): OpenPGP.enums.keyFlags => {
    if (!signature.keyFlags || !signature.verified || signature.revoked !== false) {
      // Sanity check
      return 0;
    }
    if ([opgp.enums.publicKey.dsa, opgp.enums.publicKey.rsa_sign, opgp.enums.publicKey.ecdsa, opgp.enums.publicKey.eddsa].includes(keyPacket.algorithm)) {
      return 0; // disallow encryption for these algorithms
    }
    return signature.keyFlags[0] & (opgp.enums.keyFlags.encrypt_communication | opgp.enums.keyFlags.encrypt_storage);
  };

  private static getValidSigningKeyPacketFlags = (
    keyPacket: OpenPGP.packet.PublicKey | OpenPGP.packet.SecretKey,
    signature: OpenPGP.packet.Signature
  ): OpenPGP.enums.keyFlags => {
    if (!signature.keyFlags || !signature.verified || signature.revoked !== false) {
      // Sanity check
      return 0;
    }
    if ([opgp.enums.publicKey.rsa_encrypt, opgp.enums.publicKey.elgamal, opgp.enums.publicKey.ecdh].includes(keyPacket.algorithm)) {
      return 0; // disallow signing for these algorithms
    }
    return signature.keyFlags[0] & (opgp.enums.keyFlags.sign_data | opgp.enums.keyFlags.certify_keys);
  };

  private static getSubKeySigningFlags = async (key: OpenPGP.key.Key, subKey: OpenPGP.key.SubKey): Promise<OpenPGP.enums.keyFlags> => {
    const primaryKey = key.keyPacket;
    // await subKey.verify(primaryKey);
    const dataToVerify = { key: primaryKey, bind: subKey.keyPacket };
    const date = new Date();
    const bindingSignature = await OpenPGPKey.getLatestValidSignature(
      subKey.bindingSignatures,
      primaryKey,
      opgp.enums.signature.subkey_binding,
      dataToVerify,
      date
    );
    if (
      bindingSignature &&
      bindingSignature.embeddedSignature &&
      (await OpenPGPKey.getLatestValidSignature([bindingSignature.embeddedSignature], subKey.keyPacket, opgp.enums.signature.key_binding, dataToVerify, date))
    ) {
      return OpenPGPKey.getValidSigningKeyPacketFlags(subKey.keyPacket, bindingSignature);
    }
    return 0;
  };

  private static getSubKeyEncryptionFlags = async (key: OpenPGP.key.Key, subKey: OpenPGP.key.SubKey): Promise<OpenPGP.enums.keyFlags> => {
    const primaryKey = key.keyPacket;
    // await subKey.verify(primaryKey);
    const dataToVerify = { key: primaryKey, bind: subKey.keyPacket };
    const date = new Date();
    const bindingSignature = await OpenPGPKey.getLatestValidSignature(
      subKey.bindingSignatures,
      primaryKey,
      opgp.enums.signature.subkey_binding,
      dataToVerify,
      date
    );
    if (bindingSignature) {
      return OpenPGPKey.getValidEncryptionKeyPacketFlags(subKey.keyPacket, bindingSignature);
    }
    return 0;
  };

  private static getPrimaryKeyFlags = async (key: OpenPGP.key.Key): Promise<OpenPGP.enums.keyFlags> => {
    const primaryUser = await key.getPrimaryUser();
    return (
      OpenPGPKey.getValidEncryptionKeyPacketFlags(key.keyPacket, primaryUser.selfCertification) |
      OpenPGPKey.getValidSigningKeyPacketFlags(key.keyPacket, primaryUser.selfCertification)
    );
  };

  /**
   * Get latest self-signature date, in utc millis.
   * This is used to figure out how recently was key updated, and if one key is newer than other.
   */
  private static getLastSigTime = async (key: OpenPGP.key.Key): Promise<number> => {
    await key.getExpirationTime(); // will force all sigs to be verified
    const allSignatures: OpenPGP.packet.Signature[] = [];
    for (const user of key.users) {
      allSignatures.push(...user.selfCertifications);
    }
    for (const subKey of key.subKeys) {
      allSignatures.push(...subKey.bindingSignatures);
    }
    allSignatures.sort((a, b) => b.created.getTime() - a.created.getTime());
    const newestSig = allSignatures.find(sig => sig.verified === true);
    if (newestSig) {
      return newestSig.created.getTime();
    }
    throw new Error('No valid signature found in key');
  };

  private static extractExternalLibraryObjFromKey = (pubkey: Key) => {
    if (pubkey.family !== 'openpgp') {
      throw new UnexpectedKeyTypeError(`Key type is ${pubkey.family}, expecting OpenPGP`);
    }
    const opgpKey = (pubkey as unknown as { internal: OpenPGP.key.Key }).internal;
    if (!opgpKey) {
      throw new Error('Object has type == "openpgp" but no internal key.');
    }
    return opgpKey;
  };

  private static extractStrengthUncheckedExternalLibraryObjFromKey = (pubkey: Key) => {
    if (pubkey.family !== 'openpgp') {
      throw new UnexpectedKeyTypeError(`Key type is ${pubkey.family}, expecting OpenPGP`);
    }
    const raw = pubkey as unknown as { rawKey: OpenPGP.key.Key };
    return raw?.rawKey;
  };

  private static getKeyIgnoringExpiration = async (
    getter: (keyid?: OpenPGP.Keyid | null, date?: Date, userId?: OpenPGP.UserId | null) => Promise<OpenPGP.key.Key | OpenPGP.key.SubKey | null>,
    exp: Date | number | null,
    expired: () => boolean
  ): Promise<OpenPGP.key.Key | OpenPGP.key.SubKey | null> => {
    const firstTry = await Catch.undefinedOnException(getter());
    if (firstTry) {
      return firstTry;
    }
    // eslint-disable-next-line no-null/no-null
    if (exp === null || typeof exp === 'number') {
      // If key does not expire (exp == Infinity) the encryption key should be available.
      return null; // eslint-disable-line no-null/no-null
    }
    const oneSecondBeforeExpiration = exp && expired() ? new Date(exp.getTime() - 1000) : undefined;
    if (typeof oneSecondBeforeExpiration === 'undefined') {
      return null; // eslint-disable-line no-null/no-null
    }
    const secondTry = await Catch.undefinedOnException(getter(undefined, oneSecondBeforeExpiration));
    return secondTry ? secondTry : null; // eslint-disable-line no-null/no-null
  };

  private static getSigningAndEncryptionKeys = async (key: OpenPGP.key.Key, exp: number | Date | null, expired: () => boolean) => {
    const getEncryptionKey = (keyid?: OpenPGP.Keyid | null, date?: Date, userId?: OpenPGP.UserId | null) => key.getEncryptionKey(keyid, date, userId);
    const encryptionKey = await Catch.undefinedOnException(getEncryptionKey());
    const encryptionKeyIgnoringExpiration = encryptionKey ? encryptionKey : await OpenPGPKey.getKeyIgnoringExpiration(getEncryptionKey, exp, expired);
    const getSigningKey = (keyid?: OpenPGP.Keyid | null, date?: Date, userId?: OpenPGP.UserId | null) => key.getSigningKey(keyid, date, userId);
    const signingKey = await Catch.undefinedOnException(getSigningKey());
    const signingKeyIgnoringExpiration = signingKey ? signingKey : await OpenPGPKey.getKeyIgnoringExpiration(getSigningKey, exp, expired);
    return { encryptionKey, encryptionKeyIgnoringExpiration, signingKey, signingKeyIgnoringExpiration };
  };

  /**
   * In order to prioritize strong subkeys over weak ones to solve #2715, we delete the weak ones
   * and let OpenPGP.js decide based on remaining packets
   * @param opgpKey - original OpenPGP.js key
   * @return isPrimaryKeyStrong - true, if primary key is safe to use
   *         keyWithoutWeakPackets - key with weak subkets removed
   */
  private static removeWeakKeyPackets = (opgpKey: OpenPGP.key.Key): { isPrimaryKeyStrong: boolean; keyWithoutWeakPackets: OpenPGP.key.Key } => {
    let isPrimaryKeyStrong = true;
    const packets = opgpKey.toPacketlist();
    const newPacketList = new opgp.packet.List<OpenPGP.packet.BasePacket>();
    for (const packet of packets) {
      if (OpenPGPKey.isBaseKeyPacket(packet)) {
        const { algorithm, bits } = packet.getAlgorithmInfo();
        if (!OpenPGPKey.minimumBitsByAlgo) {
          OpenPGPKey.minimumBitsByAlgo = {
            [opgp.enums.read(opgp.enums.publicKey, opgp.enums.publicKey.rsa_encrypt)]: 2048,
            [opgp.enums.read(opgp.enums.publicKey, opgp.enums.publicKey.rsa_encrypt_sign)]: 2048,
            [opgp.enums.read(opgp.enums.publicKey, opgp.enums.publicKey.rsa_sign)]: 2048,
          };
        }
        const minimumBits = OpenPGPKey.minimumBitsByAlgo[algorithm];
        if (minimumBits && bits < minimumBits) {
          if (packet === opgpKey.primaryKey) {
            // the primary key packet should remain, otherwise the key can't be parsed
            isPrimaryKeyStrong = false;
          } else {
            continue; // discard this packet as weak
          }
        }
      }
      newPacketList.push(packet);
    }
    if (packets.length !== newPacketList.length) {
      return { isPrimaryKeyStrong, keyWithoutWeakPackets: new opgp.key.Key(newPacketList) };
    }
    return { isPrimaryKeyStrong, keyWithoutWeakPackets: opgpKey };
  };

  private static arePrivateParamsMissing = (packet: OpenPGP.packet.BaseKeyPacket): boolean => {
    // detection of missing private params to solve #2887
    if (!OpenPGPKey.paramCountByAlgo) {
      OpenPGPKey.paramCountByAlgo = {
        [opgp.enums.read(opgp.enums.publicKey, opgp.enums.publicKey.rsa_encrypt)]: 6,
        [opgp.enums.read(opgp.enums.publicKey, opgp.enums.publicKey.rsa_encrypt_sign)]: 6,
        [opgp.enums.read(opgp.enums.publicKey, opgp.enums.publicKey.rsa_sign)]: 6,
        [opgp.enums.read(opgp.enums.publicKey, opgp.enums.publicKey.dsa)]: 5,
        [opgp.enums.read(opgp.enums.publicKey, opgp.enums.publicKey.elgamal)]: 4,
        [opgp.enums.read(opgp.enums.publicKey, opgp.enums.publicKey.ecdsa)]: 2,
        [opgp.enums.read(opgp.enums.publicKey, opgp.enums.publicKey.ecdh)]: 3,
        [opgp.enums.read(opgp.enums.publicKey, opgp.enums.publicKey.eddsa)]: 3,
      };
    }
    return (
      packet.algorithm &&
      !packet.isEncrypted && // isDecrypted() returns false when isEncrypted is null
      OpenPGPKey.paramCountByAlgo[packet.algorithm] > packet.params?.length
    );
  };

  private static testEncryptDecrypt = async (key: OpenPGP.key.Key): Promise<string[]> => {
    const output: string[] = [];
    try {
      const encryptedMsg = await opgp.encrypt({
        message: opgp.message.fromText(OpenPGPKey.encryptionText),
        publicKeys: key.toPublic(),
        armor: true,
      });
      output.push(`Encryption with key was successful`);
      if (key.isPrivate() && key.isFullyDecrypted()) {
        const decryptedMsg = await opgp.decrypt({
          message: await opgp.message.readArmored(encryptedMsg.data),
          privateKeys: key,
        });
        output.push(`Decryption with key ${decryptedMsg.data === OpenPGPKey.encryptionText ? 'succeeded' : 'failed!'}`);
      } else {
        output.push(`Skipping decryption because isPrivate:${key.isPrivate()} isFullyDecrypted:${key.isFullyDecrypted()}`);
      }
    } catch (err) {
      output.push(`Got error performing encryption/decryption test: ${err}`);
    }
    return output;
  };

  private static testSignVerify = async (key: OpenPGP.key.Key): Promise<string> => {
    const output: string[] = [];
    try {
      if (!key.isFullyDecrypted()) {
        return 'skipped, not fully decrypted';
      }
      const signedMessage = await opgp.message.fromText(OpenPGPKey.encryptionText).sign([key]);
      output.push('sign msg ok');
      const verifyResult = await OpenPGPKey.verify(signedMessage, [{ pubkey: await OpenPGPKey.convertExternalLibraryObjToKey(key), revoked: false }]);
      // eslint-disable-next-line no-null/no-null
      if (verifyResult.error !== null && typeof verifyResult.error !== 'undefined') {
        output.push(`verify failed: ${verifyResult.error}`);
      } else {
        if (verifyResult.match && verifyResult.signerLongids.includes(OpenPGPKey.bytesToLongid(key.getKeyId().bytes))) {
          output.push('verify ok');
        } else {
          output.push(`verify mismatch: match[${verifyResult.match}]`);
        }
      }
    } catch (e) {
      output.push(`Exception: ${String(e)}`);
    }
    return output.join('|');
  };

  private static formatDate = (date: Date | number | null, expiresInSecondsFromDate?: number | null) => {
    if (date === Infinity) {
      return '-';
    }
    if (typeof date === 'number') {
      return `UNEXPECTED FORMAT: ${date}`;
    }
    // eslint-disable-next-line no-null/no-null
    if (date === null) {
      return `null (not applicable)`;
    }
    if (typeof expiresInSecondsFromDate === 'undefined') {
      return `${date.getTime() / 1000} or ${date.toISOString()}`;
    }
    // eslint-disable-next-line no-null/no-null
    if (expiresInSecondsFromDate === null) {
      return '-'; // no expiration
    }
    const expDate = new Date(date.getTime() + expiresInSecondsFromDate * 1000);
    return `${date.getTime() / 1000} + ${expiresInSecondsFromDate} seconds, which is: ${expDate.getTime() / 1000} or ${expDate.toISOString()}`;
  };
}
