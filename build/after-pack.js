'use strict';

/**
 * electron-builder hook, run once the app is packed and before the installer is
 * built: checks that the native binding inside the package is for the system
 * the package is for, and fetches the published one when it is not.
 *
 * See `scripts/native-prebuild.js` for why this is needed at all — the short
 * version is that electron-builder does not rebuild a native module for a
 * system it is not running on, and says nothing about it.
 */

const path = require('path');

const { archName, ensureBinding } = require('../scripts/native-prebuild.js');

const BINDING = path.join(
  'app.asar.unpacked',
  'node_modules',
  'better-sqlite3',
  'build',
  'Release',
  'better_sqlite3.node'
);

/** Where the packaged resources live, which macOS spells differently. */
function resourcesDir(context) {
  if (context.electronPlatformName === 'darwin') {
    return path.join(
      context.appOutDir,
      `${context.packager.appInfo.productFilename}.app`,
      'Contents',
      'Resources'
    );
  }
  return path.join(context.appOutDir, 'resources');
}

module.exports = async function afterPack(context) {
  const platform = context.electronPlatformName;
  const electronVersion =
    context.packager.config.electronVersion || require('electron/package.json').version;
  // What the packaged Electron will demand of its native modules. Checked
  // because electron-builder packs whatever node_modules happens to hold.
  const abi = Number(require('node-abi').getAbi(electronVersion, 'electron'));

  const { action, kind, abi: now } = ensureBinding({
    file: path.join(resourcesDir(context), BINDING),
    platform,
    arch: archName(context.arch),
    electronVersion,
    abi,
    log: (line) => console.log(line),
  });
  const said = action === 'kept' ? 'déjà pour' : 'remplacée pour';
  console.log(`  • liaison native ${said} ${kind}-${archName(context.arch)}, ABI ${now ?? abi}`);
};
