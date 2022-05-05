import { readFileSync, writeFileSync } from 'fs';
import { execSync as exec } from 'child_process';

// tslint:disable:no-unsafe-any
// tslint:disable:oneliner-object-literal

/**
 * This file was originally two files: one that edited manifests, and one that copied build folders and edited mock versions
 * These steps somewhat overlap, so the two scripts were joined into one below. However, work was not yet done to assimilate them.
 */

/**
 * first, modify appropriate manifests
 */

const DIR = './build';
const version: string = JSON.parse(readFileSync('./package.json').toString()).version;

const addManifest = (toBuildType: string, transform: (manifest: { [k: string]: any }) => void) => {
  const manifest = JSON.parse(readFileSync(`${DIR}/generic-extension-wip/manifest.json`).toString());
  transform(manifest);
  writeFileSync(`${DIR}/${toBuildType}/manifest.json`, JSON.stringify(manifest, undefined, 2));
};

addManifest('chrome-consumer', manifest => {
  manifest.version = version;
});

addManifest('firefox-consumer', manifest => {
  manifest.version = version;
  manifest.applications = { gecko: { id: 'firefox@cryptup.io', update_url: 'https://flowcrypt.com/api/update/firefox', strict_min_version: '60.0' } };
  manifest.permissions = manifest.permissions.filter((p: string) => p !== 'unlimitedStorage');
  delete manifest.minimum_chrome_version;
});

addManifest('chrome-enterprise', manifest => {
  manifest.version = version;
  manifest.name = 'FlowCrypt for Enterprise';
  manifest.description = 'FlowCrypt Chrome Extension for Enterprise clients (stable)';
  // careful - changing this will likely cause all extensions to be disabled in their user's browsers
  manifest.permissions = [
    "storage",
    "tabs",
    "https://*.google.com/*",
    // customer enterprise environments use people,gmail,oauth2 subdomains of googleapis.com
    // instead of the generic www.googleapis.com subdomain as used by consumer extension
    // consumer extension could eventually start using subdomains as well,
    // but is blocked on CORS dues to either of these two options:
    //   - CORS issue on /upload Google endpoint
    //        https://partnerissuetracker.corp.google.com/issues/157312473#comment17
    //   - working around the CORS issue by adding *.googleapis.com which
    //        disables installed extensions / asks user to re-enable
    "https://*.googleapis.com/*",
    "https://flowcrypt.com/*",
    "unlimitedStorage"
  ];
  for (const csDef of manifest.content_scripts) {
    csDef.matches = csDef.matches.filter((host: string) => host === 'https://mail.google.com/*');
  }
  manifest.content_scripts = manifest.content_scripts.filter((csDef: { matches: string[] }) => csDef.matches.length); // remove empty defs
  if (!manifest.content_scripts.length) {
    throw new Error('Content script defs ended up empty in enterprise manifest');
  }
});

/**
 * second, build copy and edit enterprise and mock versions
 */

const CHROME_CONSUMER = 'chrome-consumer';
const CHROME_ENTERPRISE = 'chrome-enterprise';
const MOCK_HOST: { [buildType: string]: string } = { 'chrome-consumer': 'https://localhost:8001', 'chrome-enterprise': 'https://google.mock.flowcryptlocal.test:8001' };

const buildDir = (buildType: string) => `./build/${buildType}`;

const edit = (filepath: string, editor: (content: string) => string) => {
  writeFileSync(filepath, editor(readFileSync(filepath, { encoding: 'utf-8' })));
};

const updateEnterpriseBuild = () => {
  const replaceConstsInEnterpriseBuild: { pattern: RegExp, replacement: string }[] = [
    {
      pattern: /export const FLAVOR = 'consumer';/g,
      replacement: `export const FLAVOR = 'enterprise';`
    },
    {
      // for now we use www.googleapis.com on consumer until CORS resolved to use gmail.googleapis.com
      // (on enterprise we already use gmail.googleapis.com)
      pattern: /export const GMAIL_GOOGLE_API_HOST = '[^']+';/g,
      replacement: `export const GMAIL_GOOGLE_API_HOST = 'https://gmail.googleapis.com';`
    }
  ];
  const constFilepath = `${buildDir(CHROME_ENTERPRISE)}/js/common/core/const.js`;
  edit(constFilepath, (code: string) => {
    for (const item of replaceConstsInEnterpriseBuild) {
      if (!item.pattern.test(code)) {
        throw new Error(`Expecting to find FLAVOR in ${constFilepath}`);
      }
      code = code.replace(item.pattern, item.replacement);
    }
    return code;
  });
};

const makeMockBuild = (sourceBuildType: string) => {
  const mockBuildType = `${sourceBuildType}-mock`;
  exec(`cp -r ${buildDir(sourceBuildType)} ${buildDir(mockBuildType)}`);
  const editor = (code: string) => {
    return code
      .replace(/const (OAUTH_GOOGLE_API_HOST|GMAIL_GOOGLE_API_HOST|PEOPLE_GOOGLE_API_HOST|GOOGLE_OAUTH_SCREEN_HOST) = [^;]+;/g, `const $1 = '${MOCK_HOST[sourceBuildType]}';`)
      .replace(/const (BACKEND_API_HOST) = [^;]+;/g, `const $1 = 'https://localhost:8001/api/';`)
      .replace(/const (ATTESTER_API_HOST) = [^;]+;/g, `const $1 = 'https://localhost:8001/attester/';`)
      .replace(/https:\/\/flowcrypt.com\/api\/help\/error/g, 'https://localhost:8001/api/help/error');
  };
  edit(`${buildDir(mockBuildType)}/js/common/core/const.js`, editor);
  edit(`${buildDir(mockBuildType)}/js/common/platform/catch.js`, editor);
  edit(`${buildDir(mockBuildType)}/js/content_scripts/webmail_bundle.js`, editor);
};

const makeLocalFesBuild = (sourceBuildType: string) => {
  const localFesBuildType = `${sourceBuildType}-local-fes`;
  exec(`cp -r ${buildDir(sourceBuildType)} ${buildDir(localFesBuildType)}`);
  edit(`${buildDir(localFesBuildType)}/js/common/api/account-servers/enterprise-server.js`,
    code => code.replace('https://fes.${this.domain}', 'http://localhost:32337')
  );
};

updateEnterpriseBuild();
makeMockBuild(CHROME_CONSUMER);
makeMockBuild(CHROME_ENTERPRISE);
makeLocalFesBuild(CHROME_ENTERPRISE);
