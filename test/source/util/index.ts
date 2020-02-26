/* ©️ 2016 - present FlowCrypt a.s. Limitations apply. Contact human@flowcrypt.com */

import * as fs from 'fs';

import { KeyInfo } from '../core/pgp-key.js';

export type TestVariant = 'CONSUMER-MOCK' | 'ENTERPRISE-MOCK' | 'CONSUMER-LIVE-GMAIL';

export const getParsedCliParams = () => {
  let testVariant: TestVariant;
  if (process.argv.includes('CONSUMER-MOCK')) {
    testVariant = 'CONSUMER-MOCK';
  } else if (process.argv.includes('ENTERPRISE-MOCK')) {
    testVariant = 'ENTERPRISE-MOCK';
  } else if (process.argv.includes('CONSUMER-LIVE-GMAIL')) {
    testVariant = 'CONSUMER-LIVE-GMAIL';
  } else {
    throw new Error('Unknown test type: specify CONSUMER-MOCK or ENTERPRISE-MOCK CONSUMER-LIVE-GMAIL');
  }
  const testGroup = (process.argv.includes('FLAKY-GROUP') ? 'FLAKY-GROUP' : 'STANDARD-GROUP') as 'FLAKY-GROUP' | 'STANDARD-GROUP';
  const buildDir = `build/chrome-${(testVariant === 'CONSUMER-LIVE-GMAIL' ? 'CONSUMER' : testVariant).toLowerCase()}`;
  const poolSizeOne = process.argv.includes('--pool-size=1') || testGroup === 'FLAKY-GROUP';
  const oneIfNotPooled = (suggestedPoolSize: number) => poolSizeOne ? Math.min(1, suggestedPoolSize) : suggestedPoolSize;
  console.info(`TEST_VARIANT: ${testVariant}:${testGroup}, (build dir: ${buildDir}, poolSizeOne: ${poolSizeOne})`);
  return { testVariant, testGroup, oneIfNotPooled, buildDir, isMock: testVariant.includes('-MOCK') };
};

export type TestMessage = {
  name?: string,
  content: string[],
  unexpectedContent?: string[],
  password?: string,
  params: string,
  quoted?: boolean,
  expectPercentageProgress?: boolean,
  signature?: string[],
};

interface TestConfigInterface {
  messages: TestMessage[];
}

interface TestSecretsInterface {
  ci_admin_token: string;
  ci_dev_account: string;
  data_encryption_password: string;
  proxy?: { enabled: boolean, server: string, auth: { username: string, password: string } };
  auth: { google: { email: string, password: string, backup: string, secret_2fa: string | undefined }[], };
  keys: { title: string, passphrase: string, armored: string | null, longid: string | null }[];
  keyInfo: Array<{ email: string, key: KeyInfo[] }>;
}

export class Config {

  public static extensionId = '';

  public static secrets = JSON.parse(fs.readFileSync('test/test-secrets.json', 'utf8')) as TestSecretsInterface;

  public static key = (title: string) => {
    return Config.secrets.keys.filter(k => k.title === title)[0];
  }

}

export class Util {

  public static sleep = async (seconds: number) => {
    return await new Promise(resolve => setTimeout(resolve, seconds * 1000));
  }

  public static lousyRandom = () => {
    return Math.random().toString(36).substring(2);
  }

  public static htmlEscape = (str: string) => {
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\//g, '&#x2F;');
  }

}
