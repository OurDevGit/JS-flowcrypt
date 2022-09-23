/* ©️ 2016 - present FlowCrypt a.s. Limitations apply. Contact human@flowcrypt.com */

import { HttpClientErr, Status } from '../lib/api';
import { Dict } from '../../core/common';
import { HandlersDefinition } from '../all-apis-mock';
import { isPost, isGet } from '../lib/mock-util';
import { oauth } from '../lib/oauth';
import { expect } from 'chai';
import { GoogleData } from '../google/google-data';
import { Buf } from '../../core/buf';
import { testConstants } from '../../tests/tooling/consts';
import { Util } from '../../util';

// tslint:disable:no-blank-lines-func

const knownMockEmails = [
  'ci.tests.gmail@flowcrypt.test',
  'flowcrypt.compatibility@gmail.com',
  'human@flowcrypt.com',
  'flowcrypt.test.key.new.manual@gmail.com',
  'flowcrypt.test.key.used.pgp@gmail.com',
  'flowcrypt.test.key.recovered@gmail.com',
];

let data: GoogleData;
export const MOCK_ATTESTER_LAST_INSERTED_PUB: { [email: string]: string } = {};
const get203FAE7076005381 = async () => {
  if (!data) {
    data = await GoogleData.withInitializedData('flowcrypt.compatibility@gmail.com');
  }
  const msg = data.getMessage('17dad75e63e47f97')!;
  const msgText = Buf.fromBase64Str(msg!.raw!).toUtfStr();
  return msgText
    .match(/\-\-\-\-\-BEGIN PGP PUBLIC KEY BLOCK\-\-\-\-\-.*\-\-\-\-\-END PGP PUBLIC KEY BLOCK\-\-\-\-\-/s)![0]
    .replace(/=\r\n/g, '').replace(/=3D/g, '=');
};

export const mockAttesterEndpoints: HandlersDefinition = {
  '/attester/pub/?': async ({ body }, req) => {
    const emailOrLongid = req.url!.split('/').pop()!.toLowerCase().trim();
    if (isGet(req)) {
      if (knownMockEmails.includes(emailOrLongid)) {
        // the client does not yet check that the pubkey contains the right uids
        // once it starts checking that, we'll have to be more specific with the pubkeys
        return somePubkey;
      }
      if (emailOrLongid === 'mock.only.pubkey@flowcrypt.com') {
        return somePubkey;
      }
      if (emailOrLongid === 'test.match.attester.key@gmail.com') {
        return testMatchPubKey;
      }
      if (emailOrLongid === 'test.mismatch.attester.key@gmail.com') {
        return somePubkey;
      }
      if (emailOrLongid === 'mock.only.pubkey@other.com') {
        return somePubkey;
      }
      if (emailOrLongid === 'expired.on.attester@domain.com') {
        return expiredPubkey;
      }
      if (emailOrLongid === 'flowcrypt.compatibility@protonmail.com') {
        return protonMailCompatKey;
      }
      if (emailOrLongid === 'multiple.pub.key@flowcrypt.com') {
        return [somePubkey, protonMailCompatKey].join('\n');
      }
      if (emailOrLongid === 'some.sender@test.com') {
        return await get203FAE7076005381();
      }
      if (emailOrLongid === 'this.pubkey.takes.long.time.to.load@sender.test') {
        await Util.sleep(5);
        return await get203FAE7076005381();
      }
      if (['sams50sams50sept@gmail.com', 'sender@example.com'].includes(emailOrLongid)) {
        return testConstants.pubkey2864E326A5BE488A;
      }
      if (emailOrLongid.startsWith('martin@p')) {
        return mpVerificationKey;
      }
      if (emailOrLongid === 'sha1@sign.com') {
        return sha1signpubkey;
      }
      if (emailOrLongid === 'auto.refresh.expired.key@recipient.com') { // newer version of expired pubkey
        return newerVersionOfExpiredPubkey;
      }
      if (emailOrLongid === '8EC78F043CEB022498AFD4771E62ED6D15A25921'.toLowerCase()) {
        return testConstants.oldHasOlderKeyOnAttester;
      }
      if (emailOrLongid === 'test.ldap.priority@gmail.com') {
        return somePubkey;
      }
      if (emailOrLongid === 'test.flowcrypt.pubkeyserver.priority@gmail.com') {
        return somePubkey;
      }
      if (emailOrLongid === 'test.ldap.timeout@gmail.com') {
        return somePubkey;
      }
      if (emailOrLongid === 'test.flowcrypt.pubkey.timeout@gmail.com') {
        throw new HttpClientErr('RequestTimeout', Status.BAD_REQUEST);
      }
      if (emailOrLongid === 'attester.return.error@flowcrypt.test') {
        throw new HttpClientErr('Server error. Please try again', Status.SERVER_ERROR);
      }
      throw new HttpClientErr('Pubkey not found', 404);
    } else if (isPost(req)) {
      oauth.checkAuthorizationForEmail(req.headers.authorization, emailOrLongid);
      expect(body).to.contain('-----BEGIN PGP PUBLIC KEY BLOCK-----');
      MOCK_ATTESTER_LAST_INSERTED_PUB[emailOrLongid] = body as string;
      return 'Saved'; // 200 OK
    } else {
      throw new HttpClientErr(`Not implemented: ${req.method}`);
    }
  },
  '/attester/ldap-relay': async (parsedReq, req) => {
    const server = parsedReq.query.server;
    const emailOrLongid = parsedReq.query.search;
    if (isGet(req)) {
      if (emailOrLongid === 'test.ldap.priority@gmail.com') {
        return protonMailCompatKey;
      }
      if (emailOrLongid === 'test.flowcrypt.pubkeyserver.priority@gmail.com') {
        return protonMailCompatKey;
      }
      if (emailOrLongid === 'has.pub@client-configuration-test.flowcrypt.test') {
        return hasPubKey;
      }
      if (emailOrLongid === 'invalid.pub@client-configuration-test.flowcrypt.test') {
        return protonMailCompatKey;
      }
      if (emailOrLongid === 'test.ldap.keyserver.pgp@gmail.com' && server === 'keyserver.pgp.com') {
        return [protonMailCompatKey, testMatchPubKey].join('\n');
      }
      if (emailOrLongid === 'test.ldap.timeout@gmail.com') {
        throw new HttpClientErr('RequestTimeout', Status.BAD_REQUEST);
      }
      if (emailOrLongid === 'test.flowcrypt.pubkey.timeout@gmail.com') {
        return somePubkey;
      }
      throw new HttpClientErr('No OpenPGP LDAP server on this address.', Status.NOT_FOUND);
    } else {
      throw new HttpClientErr(`Not implemented: ${req.method}`);
    }
  },
  '/attester/welcome-message': async ({ body }, req) => {
    if (!isPost(req)) {
      throw new HttpClientErr(`Wrong method: ${req.method}`);
    }
    const { email, pubkey } = body as Dict<string>;
    expect(email).to.contain('@');
    expect(pubkey).to.contain('-----BEGIN PGP PUBLIC KEY BLOCK-----');
    return { sent: true };
  },
};

export const somePubkey = `-----BEGIN PGP PUBLIC KEY BLOCK-----
Version: CryptUP 3.2.0 Easy Gmail Encryption https://cryptup.org
Comment: Seamlessly send, receive and search encrypted email

xsBNBFU0WMgBCACZSzijeN4YozhjmHU7BGWzW7ZbY6GGtJinByt8OnEnQ9TX
9zrAxbyr0grPE4On7nd3uepwNxJbk5LlaCwHNkpX39xKgDgCskRO9CfeqOIO
4l5Wjj4XldrgLSOGJe8Vmimo9UKmqsP5v8fR3mMyIqQbtE4G+Vq/J9A3uabr
f0XYVsBdBvVoJkQ83gtQrZoTA/zihNmtLXH9pTwtX8FJcqgFK6RgvfAh2jCz
DhT+reI50ZcuHRvVRxvrL172DFSQsLSdj8PcewS1J89knH4sjjBC/kwbLa0n
tod/gBPWw/uetaOJna43wNueUKKOl2kAXE4sw6ESIrlFDynJ4g05T9yxABEB
AAHNIlRvbSBKYW1lcyBIb2x1YiA8dG9tQGJpdG9hc2lzLm5ldD7CwFwEEAEI
ABAFAlU0WM8JEA1WiOvzECvnAAAB4gf8DaIzZACUqkGEoI19HyBPtcrJT4mx
hKZ/Wts0C6TGj/OQXevDI+h2jQTYf8+fOqCdQev2Kwh/8mQV6wQqmN9uiVXO
5F4vAbWNfEve6mCVB5gi296mFf6kx04xC7VVYAJ3FUR72BplE/0+cwv9Nx2r
Jh3QGFhoPaFMPtCAk0TgKcO0UkcBwXNzAV5Pgz0MT1COTWBXEej4yOrqdWoP
A6fEpV8aLaFnAt+zh3cw4A7SNAO9omGAUZeBl4Pz1IlN2lC2grc2zpqoxo8o
3W49JYTfExeCNVWhlSU74f6bpN6CMdSdrh5phOr+ffQQhEhkNblUgSZe6tKa
VFI1MhkJ6Xhrug==
=+de8
-----END PGP PUBLIC KEY BLOCK-----`;

const testMatchPubKey = `-----BEGIN PGP PUBLIC KEY BLOCK-----

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
hcNvAZK183w=
=Ayyi
-----END PGP PUBLIC KEY BLOCK-----
`;

const expiredPubkey = `-----BEGIN PGP PUBLIC KEY BLOCK-----

xsBNBGANSYYBCACkVfVUKS9ura0KSiRu6i4bC0mEpwOjuYotor1d1NciysN977UMKQw1uux0GIZz
3PvJUL4Ij77eyF5wxOueOwqON/LHunqnufvES9zj2BgQLwfE5d7gXp0IjQqWEg4YfSkTNIwzP67R
qDbvW4E7XScLY1BYutrZhq53rzXurON9eftFi2ScW4/Pja2eCah5bMxFqoINRGFYJwK6Z6rD1h2+
/w5s9Ir+qELUKxIYtwfp2Uf3uTDnT4BRFPcuNh9rXLPpXprTjGe2cZ6i9ENzMj0dTlU8kqvTyhPm
BReZZZcUe5teVyfbLXmz/nQCnxnuH/e8LDeQ5TC6knTFd8d9gTI7ABEBAAHNHmV4cGlyZWQub24u
YXR0ZXN0ZXJAZG9tYWluLmNvbcLAjwQTAQgAORYhBBr54+QEmYDLPhttjC90yktngnCgBQJgDUmL
BQkAAAA8AhsDBQsJCAcCBhUICQoLAgUWAgMBAAAKCRAvdMpLZ4JwoLb0B/0cFAn266wKMNSq556G
ldLCLDpPrMaKy6r3qsiG/Y3otvnn+iBLqkuEo7P9XmfQooiplpUxLnmiBmGxlVmUcNMBh15Z7GXP
cj4fas++H1sjAbF6mPqhggIsxGcnk9YjbZC+GaDzKp5BKgDUUIitsYzSENdADqeL6SQixSMWAiGA
CiOQ8mnriH/CGb1XW76YVjYa5fK2OqflQj+l5IiJ4gqWuHpYs5zR24tnxIiv5UtvxglahV8Tugdf
KfjnkfYbJEwxyUGzXNtmqhsrhoSWaYbrqjRqNolnFP6hr5NlVVNA9XNWLhWd0HdhzgJWYvd+ukLE
eTY/IvQlyIVMV9nqQqOVzsBNBGANSYwBCADFzPusdjjO0zcI/7sfgUHk/XmPawR6WIhzTHaM38Pg
1woaXZt0oSU6K2OSKwYRnuVGM0zbjhhICPhtAo3m26h4LojPlM1Dnp+U/p9hXVFa7MPtlUupfhZt
9Ip4nNLWyYhQrSAI73InVtJvYQbQU/t7or+twrXZJqAPIqMBQ+pkYab8+bOfdY+/QoHM7SKyvggg
6E+4fw9IwwaoZpxcbc2Wbcn1LpaF2xZUq0kWxtQ86b6rMQWbNgfs4xVUKAeP74SINM5iYDV4qjD0
KTTzAmn/rlBbvwP2r7SX1gmismLJYDJCpZrYdJEMOMhfXBQaz+0rlHIT6YIyr1mpLecJzIXRABEB
AAHCwHwEGAEIACYWIQQa+ePkBJmAyz4bbYwvdMpLZ4JwoAUCYA1JkQUJAAAAPAIbDAAKCRAvdMpL
Z4JwoGmXB/97g6/UkdVtBv5bP1V7JZpxEo31Q0S3dZR6pMVaEpVgtksSIcO2i9PdCZhYZ9noRkdO
BpSNkgVOzk6/WvpVBl8TZ7bpWa7ux6ExiJLKKjWSHnJJ3SkviARSrAmDfvDCxKh3duEmjsmBy/r0
ugFu0E2D/Oxqa6ZUv7swwx8kuq7/UchZLQQCiKCGosRqiApqhp2ze/CNzeD/na+q0yvT6pFFDjGl
82Yrr1oqCyZZedSFSLelVqBJ8FkyJlqN3J9Q3M5rEp5vcRqGOHxfO5j2Gb88mmmtnWnBzRPPX8CB
DDF85HtNOR10V1aJrfE7F6e3QTzu5SZBjDPi5vVcbtK72eyd
=o0Ib
-----END PGP PUBLIC KEY BLOCK-----
`;

export const protonMailCompatKey = `-----BEGIN PGP PUBLIC KEY BLOCK-----
Version: OpenPGP.js v3.0.5
Comment: https://openpgpjs.org

xsBNBFskt/ABCAD0N+Y+ZavNGwRif9vkjcHxmvWkkqBO+pA1KanPUftoi2b/
zMErfl+4P6xe+KpDS97W/BqBGKP7bzN08XSkqyROhv/lroofXgu1WSJ53znf
bRGiRmOjIntBX7iSKecSh9zcgjBRK6xnhoaXxUhCwp8ZsxapMRSwQmlXU6WQ
4XAI4JhtZVpBUtbeUW0/+4KRObmj9Dy+4nnNFFBubBrHV0F7FmkJkvksvkNL
4awmTFbfPE8vkapoDi1hFzMbWoYvEPLmv/HTRcqjPZASLr7fXG+AOefE8uJA
L++Zs0jw2ukrk9KHk3q70ii61CUz9zODCXzeoWQMNTUHoZFuhzawCFe1ABEB
AAHNT2Zsb3djcnlwdC5jb21wYXRpYmlsaXR5QHByb3Rvbm1haWwuY29tIDxm
bG93Y3J5cHQuY29tcGF0aWJpbGl0eUBwcm90b25tYWlsLmNvbT7CwHUEEAEI
ACkFAlskt/EGCwkHCAMCCRB+1D156WF2VQQVCAoCAxYCAQIZAQIbAwIeAQAA
2hYIANsYeRHhz5odpXWbeLc//Ex90llhgWb/kWWW5O5/mQwrOt+4Ct0ZL45J
GeXCQyirHiYhmA50BoDDfayqULDx17v6easDmfdZ2qkVxczc+TjF0VMI+Y/3
GrPuVddzBomc7qqYmEOkKEcnz4Q7mX5Ti1ImY8SSVPOchIbOQUFa96VhZJAq
Xyx+TIzalFQ0F8O1Xmcj2WuklBKAgR4LIX6RrESDcxrozYLZ+ggbFYtf2RBA
tEhsGyA3cJe0d/34jlhs9yxXpKsXGkfVd6atfHVoS7XlJyvZe8nZgUGtCaDf
h5kJ+ByNPQwhTIoK9zWIn1p6UXad34o4J2I1EM9LY4OuONvOwE0EWyS38AEI
ALh5KJNcXr0SSE3qZ7RokjsHl+Oi0YZBiHg0HBZsliIwMBLbR007aSSIAmLa
fJyZ0cD/BmQxHguluaTomfno3GYrjyM86ETz+C0YJJ441Fcji/0fFr8JexXf
eX4GEIVxQd4L0tB7VAAKMIGv/VAfLBpKjfY32LbgiVqVvgkxBtNNGXCaLXNa
3l6l3/xo6hd4/JFIlaVTEb8yI578NF5nZSYG5IlF96xX7kNKj2aKXvdppRDc
RG+nfmDsH9pN3bK4vmfnkI1FwUciKhbiwuDPjDtzBq6lQC4kP89DvLrdU7PH
n2PQxiJyxgjqBUB8eziKp63BMTCIUP5EUHfIV+cU0P0AEQEAAcLAXwQYAQgA
EwUCWyS38QkQftQ9eelhdlUCGwwAAKLKB/94R0jjyKfMGe6QY5hKnlMCNVdD
NqCl3qr67XXCnTuwnwR50Ideh+d2R4gHuu/+7nPo2juCkakZ6rSZA8bnWNiT
z6MOL1b54Jokoi1MreuyA7mOqlpjhTGbyJewFhUI8ybGlFWCudajobY2liF6
AdeK17uMFfR6I1Rid3Qftszqg4FNExTOPHFZIc8CiGgWCye8NKcVqeuVlXKw
257TmI5YAxZAyzhc7iX/Ngv6ZoR18JwKvLP1TfTJxFCG5APb5OSlQmwG747I
EexnUn1E1mOjFwiYOZavCLvJRtazGCreO0FkWtrrtoa+5F2fbKUIVNGg44fG
7aGdFze6mNyI/fMU
=D34s
-----END PGP PUBLIC KEY BLOCK-----`;

const mpVerificationKey = `-----BEGIN PGP PUBLIC KEY BLOCK-----
Version: SKS 1.1.6
Comment: Hostname: keyserver.ubuntu.com

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
D+QpnsOtKCqDWiq6s1l0UasWPk7xv6awH29H
=EpXD
-----END PGP PUBLIC KEY BLOCK-----`;

const newerVersionOfExpiredPubkey = `-----BEGIN PGP PUBLIC KEY BLOCK-----
Version: FlowCrypt Email Encryption 7.8.4
Comment: Seamlessly send and receive encrypted email

xsBNBF8PcdUBCADi8no6T4Bd9Ny5COpbheBuPWEyDOedT2EVeaPrfutB1D8i
CP6Rf1cUvs/qNUX/O7HQHFpgFuW2uOY4OU5cvcrwmNpOxT3pPt2cavxJMdJo
fwEvloY3OfY7MCqdAj5VUcFGMhubfV810V2n5pf2FFUNTirksT6muhviMymy
uWZLdh0F4WxrXEon7k3y2dZ3mI4xsG+Djttb6hj3gNr8/zNQQnTmVjB0mmpO
FcGUQLTTTYMngvVMkz8/sh38trqkVGuf/M81gkbr1egnfKfGz/4NT3qQLjin
nA8In2cSFS/MipIV14gTfHQAICFIMsWuW/xkaXUqygvAnyFa2nAQdgELABEB
AAHNKDxhdXRvLnJlZnJlc2guZXhwaXJlZC5rZXlAcmVjaXBpZW50LmNvbT7C
wI0EEAEIACAFAl8Pc5cGCwkHCAMCBBUICgIEFgIBAAIZAQIbAwIeAQAhCRC+
46QtmpyKyRYhBG0+CYZ1RO5ify6Sj77jpC2anIrJ/awIAMVNZmNzQkWA9uZr
Rity+QME43ySC6p9cRx3o39apmOuVn6TOv/n9tfAlR/lYNZR80myhNi4xkQe
BpuTSJ8WAIw+9CIXrROV/YBdqvPXucYUZGjkAWzN6StQUfYP8nRm6+MebgLI
B/s+Lkr1d7wrDDF8rh7Ir9SkpXqr5FPTkDMsiFEbUR7oKpRoeI9zVtF375FB
ZJMUxm8YU+Tj1LAEullgrO9omHyMVqAVffZe6rH62c7L9ZR3C3/oG5rNcC/0
kIRsh0QGrq+kuZ6bsLFBhDLIjci8DH9yO1auceNy+Xa1U6scLb1ZZpVfV5R9
HWPy4QcNitDMoAtqVPYxPQYqRXXOwE0EXw9x1QEIALdJgAsQ0JnvLXwAKoOa
mmWlUQmracK89v1Yc4mFnImtHDHS3pGsbx3DbNGuiz5BhXCdoPDfgMxlGmJg
Shy9JAhrhWFXkvsjW/7aO4bM1wU486VPKXb7Av/dcrfHH0ASj4zj/TYAeubN
oxQtxHgyb13LVCW1kh4Oe6s0ac/hKtxogwEvNFY3x+4yfloHH0Ik9sbLGk0g
S03bPABDHMpYk346406f5TuP6UDzb9M90i2cFxbq26svyBzBZ0vYzfMRuNsm
6an0+B/wS6NLYBqsRyxwwCTdrhYS512yBzCHDYJJX0o3OJNe85/0TqEBO1pr
gkh3QMfw13/Oxq8PuMsyJpUAEQEAAcLAdgQYAQgACQUCXw9zlwIbDAAhCRC+
46QtmpyKyRYhBG0+CYZ1RO5ify6Sj77jpC2anIrJzogH/2sRLw/hL2asprWR
U78VdhG+oUKKoNYvLFMJ93jhIB805E87kDB1Cietxg1xTj/lt911oK6eyoe4
CekCU25WkxmsAh0NUKz/1D6wJ1uDyh2lkmgyX+Iz9RCjtDHnnuzM1It77z6F
lGemOmYh8ZLYxJmG6e3MqHelRH25TuPm6fB0TN7lRlleTl26/8aJDBCvp7N1
4AdIgRWhBCoByCNe8QuNiZ0Bb+TLOt0jVVder645fVWx+4te0tpHTbGn9e3c
nLDskCEyJFvADug883x3lswUqh65zLO22m/plVmJ7X++whhSsDyQQRFiH0Du
1uh93GjDDNgrP1GfAMeRjZ4V8R8=
=R9m4
-----END PGP PUBLIC KEY BLOCK-----
`;

const sha1signpubkey = `-----BEGIN PGP PUBLIC KEY BLOCK-----

xsBNBGANYRQBCADI3WP21Ut4L+g+qBBMk24cxsAX4N+FisqcxW7jhrqksH9Mi2vhpDFZyUCRe4d8
liXGTfiWnkp9qQIos8vnC6yPf9gNxsrjlccVVIiusoJB18KqsiKVBUiiqbNQwLUCACMA5PCALaBJ
1TRrTy5hWPCa8v+iyxTr2LaE7BcJCv1eGB3/vfsIt9zf2fsRga7FroJHSOdrxAPMu5rIU5iHwGPe
nFe2dSt8Y+dX5YKV7IBbjP7/Vp+/gV2HItaKmHFXP5FOtndPPCOtnIp6vUNZwA/o4K7tmiz6ZFp0
/Yn2DwUK0Nmmr+2v75FRnWqtelgACEDuGfrvYeJwAZIOmV0fr5yxABEBAAHNDXNoYTFAc2lnbi5j
b23CwIkEEwECADMWIQRXddqCmBkCxSCZ5qPIqyMsf2dexAUCYA1hGgIbAwULCQgHAgYVCAkKCwIF
FgIDAQAACgkQyKsjLH9nXsTM5AgAwWhDr2X9LY+7eJGyihkwXDCBZUvjF0hpY+8FYyxllfbW45pu
0bVs5T/EfnUYr+fOZuHdmhz4lNI2BPDwHhdQZpIqrrimD6jrypwcb500hwu5FKUBzw6U39QDuOSc
W6wIkiZ7hajTSTzniQRpbYZaKPrsFY40uZeQo6rAl71iuRsVvCjCazX8McOdGGP7oJCxtCpxaHoL
S2RcVu5/SWmEi8wHopDCKf/1UJphjJDeIHgdLwM6xMLrYBfbt6Fd2PYpJ17+ECs8Y9Q2v5nyXFaD
q+/Ri36rk3lz5YJGyB2AOFG+ma80SlOsCbA6j9Ky49tJZ1we6F368Lujrxnb+xMKY87ATQRgDWEa
AQgAqy0j+/GZvh4o7EabTtPKLOkVtQp/OV0ZGw6SKnhDB7pJhHKqgRduK4NYr1u+t575NI7EwgR3
7qoZkuvs/KmFizTxosCgL7WC6o5Groibc2XrL8mXbGDqWzKGllvKO+7gfkwx5qh0MoOXHWaavxE3
eXM6vvlATcjLkTjISiqzK/jSAmqB9J3GdqFafmtjqm/4Nfu1FGgpWi9JJxpv5aN8nILYksL/X+s8
ounYOz+OpUU+liv2wU3eRXP2/Qzc7Acdkrw5hRert9u+klHB3MckNUujVqq0mxB1yrPeJjqOBPCl
2n/wNLUoLqWbP/TW40MSFPAYdR/z+T67MDmRzVlewQARAQABwsB2BBgBAgAgFiEEV3XagpgZAsUg
meajyKsjLH9nXsQFAmANYR8CGwwACgkQyKsjLH9nXsSw8wf8CedMX61foCmCOEmKCscH+GcFKWwH
S4xlOPQZG4RXFla/VMvJrHqbxZ5vIID0GQ+t6kdhuD0ws9Y7DObFcSCxqPm8idkJUvC4kv1MSu+P
7NbWDS8t7e/b1EOu+aeIxqUhaQrJacWWiUn9tbobpld8GGlquLIteY9Ix2H/xjXnDvpB30v/fDNG
T/X6OnVQdcOI7SvdQI74SxbaHnEeCLDEk7dOhWLJBLuZwK7M3cT6BX+V2v6Fm7SX0hSpDg1HK0KL
qHJuDNEmMUvx3cMUd5HtsOFO9JapCp1iCVo2p49CIXA4NUrLETNM2ZddknhbFm8bsK48tTJEH6l4
Wq3aCVXYGg==
=Ldag
-----END PGP PUBLIC KEY BLOCK-----`;

const hasPubKey = `-----BEGIN PGP PUBLIC KEY BLOCK-----

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
cvQabqad/ZghLSTzo/Kf
=sshZ
-----END PGP PUBLIC KEY BLOCK-----`;