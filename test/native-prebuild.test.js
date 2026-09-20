'use strict';

/**
 * The native binding that goes into a package, for the system that package is
 * for.
 *
 * Building `--win` from Linux copied the ELF binding into `Ariane.exe` without
 * a word: electron-builder does not rebuild a native module for a system it is
 * not running on. Nothing here would have caught it — the build succeeded, the
 * installer opened, and the index would have failed to open on the first launch
 * on someone else's computer. So the packaging now reads the binary's first
 * bytes, which cannot lie about what system they are for.
 *
 * As with the terminal, the tests inject what would reach the outside:
 * **no test here downloads anything.**
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  ARCH_NAMES,
  archName,
  assetName,
  binaryKind,
  ensureBinding,
  inspectBinding,
  kindOfFile,
} = require('../scripts/native-prebuild.js');

/** The opening bytes of a real library of each kind, and nothing more. */
const HEADS = {
  linux: Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]),
  win32: Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]),
  darwin: Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0x00, 0x00, 0x01]),
};

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ariane-prebuild-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A stand-in for a packaged binding of a given kind. */
function bindingFile(dir, kind, name = 'better_sqlite3.node') {
  const file = path.join(dir, name);
  fs.writeFileSync(file, Buffer.concat([HEADS[kind], Buffer.alloc(64)]));
  return file;
}

test.describe('which system a compiled library is for', () => {
  test('ELF is Linux', () => {
    assert.equal(binaryKind(HEADS.linux), 'linux');
  });

  test('MZ is Windows', () => {
    assert.equal(binaryKind(HEADS.win32), 'win32');
  });

  test('every Mach-O magic is macOS, either endianness, fat or thin', () => {
    for (const magic of [0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca]) {
      const head = Buffer.alloc(8);
      head.writeUInt32BE(magic, 0);
      assert.equal(binaryKind(head), 'darwin', `0x${magic.toString(16)}`);
    }
  });

  test('anything else is unknown rather than guessed', () => {
    assert.equal(binaryKind(Buffer.from('not a library at all')), 'unknown');
  });

  test('a file too short to say is unknown, not a crash', () => {
    assert.equal(binaryKind(Buffer.from([0x7f])), 'unknown');
    assert.equal(binaryKind(Buffer.alloc(0)), 'unknown');
  });

  test('a file that is not there reads as nothing, not as a kind', (t) => {
    assert.equal(kindOfFile(path.join(tempDir(t), 'absent.node')), null);
  });

  test('a file on disk is read by its first bytes', (t) => {
    const dir = tempDir(t);
    assert.equal(kindOfFile(bindingFile(dir, 'win32')), 'win32');
  });
});

test.describe('the published binary each target needs', () => {
  test('is named as better-sqlite3 publishes it', () => {
    assert.equal(
      assetName({ version: '11.10.0', abi: 130, platform: 'win32', arch: 'x64' }),
      'better-sqlite3-v11.10.0-electron-v130-win32-x64.tar.gz'
    );
  });

  test('names the runtime asked for', () => {
    assert.equal(
      assetName({
        version: '11.10.0',
        runtime: 'node',
        abi: 127,
        platform: 'darwin',
        arch: 'arm64',
      }),
      'better-sqlite3-v11.10.0-node-v127-darwin-arm64.tar.gz'
    );
  });

  test('architectures are named as electron-builder numbers them', () => {
    assert.equal(archName(1), 'x64');
    assert.equal(archName(3), 'arm64');
    assert.equal(archName('ia32'), 'ia32');
    assert.deepEqual(ARCH_NAMES, ['ia32', 'x64', 'armv7l', 'arm64', 'universal']);
  });

  test('an architecture nobody knows stops the build', () => {
    assert.throws(() => archName(42), /architecture inconnue/);
    assert.throws(() => archName('vax'), /architecture inconnue/);
  });
});

test.describe('the binding inside a package', () => {
  const target = { platform: 'win32', arch: 'x64', electronVersion: '33.4.11' };

  test('is left alone when it already matches the target', (t) => {
    const file = bindingFile(tempDir(t), 'win32');
    let called = false;
    const result = ensureBinding({
      ...target,
      file,
      fetch: () => {
        called = true;
        return file;
      },
    });
    assert.deepEqual(result, { action: 'kept', kind: 'win32', abi: null });
    assert.equal(called, false, 'rien à télécharger quand la liaison est déjà la bonne');
  });

  test('is replaced when it is for the machine that built it', (t) => {
    const dir = tempDir(t);
    const file = bindingFile(dir, 'linux');
    const fetched = bindingFile(dir, 'win32', 'downloaded.node');

    const result = ensureBinding({ ...target, file, fetch: () => fetched });

    assert.deepEqual(result, { action: 'replaced', kind: 'win32', abi: null });
    assert.equal(kindOfFile(file), 'win32');
  });

  test('the download is asked for the target, never for this machine', (t) => {
    const dir = tempDir(t);
    const file = bindingFile(dir, 'linux');
    const asked = [];
    ensureBinding({
      ...target,
      file,
      fetch: (options) => {
        asked.push(options);
        return bindingFile(dir, 'win32', 'downloaded.node');
      },
    });
    assert.equal(asked.length, 1);
    assert.equal(asked[0].platform, 'win32');
    assert.equal(asked[0].arch, 'x64');
    assert.equal(asked[0].electronVersion, '33.4.11');
  });

  test('a package with no binding at all stops the build', (t) => {
    assert.throws(
      () =>
        ensureBinding({ ...target, file: path.join(tempDir(t), 'absent.node'), fetch: () => '' }),
      /liaison native absente/
    );
  });

  // The half that was missing, and the one that shipped a broken .deb: the
  // system was right, the runtime was not, and the two files look identical.
  test('a binding for the wrong runtime is replaced, though the system is right', (t) => {
    const dir = tempDir(t);
    const file = bindingFile(dir, 'win32');
    const asked = [];
    const result = ensureBinding({
      ...target,
      abi: 130,
      file,
      inspect: () => (asked.length ? { kind: 'win32', abi: 130 } : { kind: 'win32', abi: 127 }),
      fetch: (options) => {
        asked.push(options);
        return bindingFile(dir, 'win32', 'downloaded.node');
      },
    });
    assert.deepEqual(result, { action: 'replaced', kind: 'win32', abi: 130 });
    assert.equal(asked.length, 1, 'le binaire de la bonne ABI a bien été demandé');
  });

  test('the right system and the right runtime are left alone', (t) => {
    const file = bindingFile(tempDir(t), 'win32');
    const result = ensureBinding({
      ...target,
      abi: 130,
      file,
      inspect: () => ({ kind: 'win32', abi: 130 }),
      fetch: () => assert.fail('rien à télécharger'),
    });
    assert.deepEqual(result, { action: 'kept', kind: 'win32', abi: 130 });
  });

  test('an ABI that cannot be read here is not an ABI that is wrong', (t) => {
    // A Windows binary cross-built from Linux cannot be loaded to be asked.
    const file = bindingFile(tempDir(t), 'win32');
    const result = ensureBinding({
      ...target,
      abi: 130,
      file,
      inspect: () => ({ kind: 'win32', abi: null }),
      fetch: () => assert.fail('une question sans réponse ne vaut pas un défaut'),
    });
    assert.equal(result.action, 'kept');
  });

  test('a download that is still the wrong runtime stops the build', (t) => {
    const dir = tempDir(t);
    const file = bindingFile(dir, 'win32');
    assert.throws(
      () =>
        ensureBinding({
          ...target,
          abi: 130,
          file,
          inspect: () => ({ kind: 'win32', abi: 127 }),
          fetch: () => bindingFile(dir, 'win32', 'downloaded.node'),
        }),
      /vise l'ABI 127, pas 130/
    );
  });

  test('the runtime of a real binding is read from the loader itself', () => {
    // prebuilds/ holds both, built by this repo: the one for Node loads here,
    // the one for Electron refuses and says which version it wants.
    const node = inspectBinding(path.join(__dirname, '..', 'prebuilds', 'better_sqlite3-node.node'));
    const electron = inspectBinding(path.join(__dirname, '..', 'prebuilds', 'better_sqlite3-electron.node'));
    assert.equal(node.abi, Number(process.versions.modules));
    assert.ok(electron.abi > node.abi, `electron ${electron.abi} > node ${node.abi}`);
    assert.equal(electron.kind, node.kind);
  });

  test('a download for the wrong system stops the build rather than shipping', (t) => {
    const dir = tempDir(t);
    const file = bindingFile(dir, 'linux');
    assert.throws(
      () =>
        ensureBinding({
          ...target,
          file,
          fetch: () => bindingFile(dir, 'darwin', 'downloaded.node'),
        }),
      /reste darwin, pas win32/
    );
  });
});
