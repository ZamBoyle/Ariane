'use strict';

/**
 * The native binding that goes INTO a package, for the system that package is
 * for — not for the machine that built it.
 *
 * `prebuilds/` holds the two bindings this machine needs (Node for the tests,
 * Electron for the app) and `src/core/binding.js` picks one by path. Inside a
 * package that directory is not shipped, so better-sqlite3 falls back to its own
 * `build/Release/better_sqlite3.node` — and the CLAUDE.md said electron-builder
 * rebuilds that one for the target. It does not, when the target is not this
 * machine: building `--win` from Linux copied the ELF binding straight into
 * `Ariane.exe`, and the index would have failed to open on the first launch,
 * on someone else's computer, with nothing here to show for it.
 *
 * A native module cannot be compiled for Windows from Linux — there is no
 * compiler for it here. But better-sqlite3 publishes a binary for every
 * (runtime, ABI, system, architecture) it supports, and `prebuild-install`
 * exists to fetch exactly that. So: fetch the right one, and REFUSE TO BUILD if
 * what comes back is not for the system asked for. A package that ships the
 * wrong binary is worse than a build that stops.
 *
 * Nothing here writes into node_modules: the download lands in a temporary
 * directory, and the hook copies it into the packaged output.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MODULE = 'better-sqlite3';

/** electron-builder's `Arch` enum, in its own order. */
const ARCH_NAMES = ['ia32', 'x64', 'armv7l', 'arm64', 'universal'];

/**
 * Which system a compiled library is for, read from its first bytes — the one
 * fact a file cannot lie about.
 *
 * @param {Buffer} head At least the first eight bytes of the file.
 * @returns {'linux'|'win32'|'darwin'|'unknown'}
 */
function binaryKind(head) {
  if (head.length >= 4 && head[0] === 0x7f && head.toString('latin1', 1, 4) === 'ELF')
    return 'linux';
  if (head.length >= 2 && head.toString('latin1', 0, 2) === 'MZ') return 'win32';
  if (head.length >= 4) {
    const magic = head.readUInt32BE(0);
    // Mach-O, either endianness, 32 or 64 bit, and the fat binary that holds several.
    if ([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca].includes(magic)) {
      return 'darwin';
    }
  }
  return 'unknown';
}

/** The same question, of a file on disk. A file that is not there is `null`. */
function kindOfFile(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  try {
    const head = Buffer.alloc(8);
    const read = fs.readSync(fd, head, 0, 8, 0);
    return binaryKind(head.subarray(0, read));
  } finally {
    fs.closeSync(fd);
  }
}

/** `better-sqlite3-v11.10.0-electron-v130-win32-x64.tar.gz`, as published. */
function assetName({ name = MODULE, version, runtime = 'electron', abi, platform, arch }) {
  return `${name}-v${version}-${runtime}-v${abi}-${platform}-${arch}.tar.gz`;
}

/** The architecture electron-builder is packaging for, named as prebuild-install names it. */
function archName(arch) {
  const name = typeof arch === 'number' ? ARCH_NAMES[arch] : arch;
  if (!name || !ARCH_NAMES.includes(name)) throw new Error(`architecture inconnue : ${arch}`);
  return name;
}

/**
 * Download the published binding for one target, and hand back where it landed.
 *
 * @param {{platform: string, arch: string, electronVersion: string, log?: Function}} target
 * @returns {string} Path to a `better_sqlite3.node` for that system.
 * @throws If nothing is published for it, or if what arrives is for another system.
 */
function fetchBinding({ platform, arch, electronVersion, log = () => {} }) {
  const pkg = require(path.join(ROOT, 'node_modules', MODULE, 'package.json'));
  const abi = require(path.join(ROOT, 'node_modules', 'node-abi')).getAbi(
    electronVersion,
    'electron'
  );
  const asset = assetName({ version: pkg.version, abi, platform, arch });

  const dir = path.join(os.tmpdir(), `ariane-prebuild-${platform}-${arch}-v${abi}`);
  const binding = path.join(dir, 'build', 'Release', 'better_sqlite3.node');
  if (kindOfFile(binding) === platform) {
    log(`[prebuild] déjà là : ${asset}`);
    return binding;
  }

  // prebuild-install reads the package it stands in: name, version and
  // repository are all it needs to find the release. A copy of those three
  // fields keeps node_modules untouched.
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    `${JSON.stringify({ name: pkg.name, version: pkg.version, repository: pkg.repository }, null, 2)}\n`
  );

  log(`[prebuild] ${asset}`);
  const result = spawnSync(
    process.execPath,
    [
      path.join(ROOT, 'node_modules', 'prebuild-install', 'bin.js'),
      '--runtime=electron',
      `--target=${electronVersion}`,
      `--platform=${platform}`,
      `--arch=${arch}`,
      '--tag-prefix=v',
    ],
    { cwd: dir, encoding: 'utf8' }
  );
  if (result.status !== 0) {
    const said = `${result.stderr || ''}${result.stdout || ''}`.trim();
    throw new Error(`aucun binaire publié pour ${asset}\n${said}`);
  }

  const kind = kindOfFile(binding);
  if (kind !== platform) {
    throw new Error(`${asset} contient un binaire ${kind ?? 'introuvable'}, pas ${platform}`);
  }
  return binding;
}

/**
 * Which runtime a compiled addon was built for, by asking the loader.
 *
 * The system is written in the first bytes; the ABI is not written anywhere a
 * reader can see. But the loader knows, and says so when it refuses: "was
 * compiled against a different Node.js version using NODE_MODULE_VERSION 127".
 * The first number in that sentence is the module's own.
 *
 * @param {string} file
 * @returns {number|null} The addon's NODE_MODULE_VERSION, or null when the file
 *   cannot be judged here at all — a binary for another system, typically.
 */
function abiOf(file) {
  // In a CHILD, never here. Loading a native addon is not a read: the library
  // stays loaded, runs its own teardown at exit, and a mismatched one dies with
  // SIGILL rather than an exception — the trap this repo was built around.
  // Asked in-process, it made electron-builder exit 1 with the package already
  // written and nothing said. A child answers the question and takes the risk.
  const probe =
    'try { process.dlopen({ exports: {} }, process.argv[1]); console.log(process.versions.modules); }' +
    " catch (error) { const said = /NODE_MODULE_VERSION (\\d+)/.exec(String(error.message));" +
    " console.log(said ? said[1] : ''); }";
  const asked = spawnSync(process.execPath, ['-e', probe, file], { encoding: 'utf8' });
  const abi = Number(String(asked.stdout || '').trim());
  return Number.isInteger(abi) && abi > 0 ? abi : null;
}

/** What is in the package now: which system, and which runtime. */
function inspectBinding(file) {
  const kind = kindOfFile(file);
  if (kind === null) return null;
  // Only a binary for THIS system can be handed to this loader; for any other
  // the refusal says nothing about the ABI, so the question is not asked.
  return { kind, abi: kind === process.platform ? abiOf(file) : null };
}

/**
 * Make the binding inside a packaged app be the one that package will actually
 * load: the right system AND the right runtime.
 *
 * The ABI is the half that was missing, and its absence shipped a broken .deb:
 * electron-builder packs whatever `node_modules` holds, and `npm rebuild` — or
 * anything that runs it — leaves the Node build there. An ELF for Node and an
 * ELF for Electron are the same file to the eye, and the app then dies on its
 * first query with NODE_MODULE_VERSION 127 against 130.
 *
 * @param {{file: string, platform: string, arch: string, electronVersion: string,
 *          abi?: number|null, fetch?: Function, inspect?: Function, log?: Function}} options
 *   `fetch` and `inspect` are injected by the tests: no test reaches the network.
 * @returns {{action: 'kept'|'replaced', kind: string, abi: number|null}}
 */
function ensureBinding({
  file,
  platform,
  arch,
  electronVersion,
  abi = null,
  fetch = fetchBinding,
  inspect = inspectBinding,
  log = () => {},
}) {
  const present = inspect(file);
  if (present === null) throw new Error(`liaison native absente du paquet : ${file}`);

  const wrongSystem = present.kind !== platform;
  // A null ABI means "not askable here", never "wrong": a Windows binary
  // cross-built from Linux cannot be loaded to be questioned.
  const wrongRuntime = abi !== null && present.abi !== null && present.abi !== abi;
  if (!wrongSystem && !wrongRuntime) return { action: 'kept', kind: present.kind, abi: present.abi };

  log(
    wrongSystem
      ? `[prebuild] la liaison emballée est ${present.kind}, la cible est ${platform}`
      : `[prebuild] la liaison emballée vise l'ABI ${present.abi}, Electron demande ${abi}`
  );
  const source = fetch({ platform, arch, electronVersion, log });
  fs.copyFileSync(source, file);

  const now = inspect(file);
  if (!now || now.kind !== platform) {
    throw new Error(`la liaison native reste ${now ? now.kind : 'introuvable'}, pas ${platform}`);
  }
  if (abi !== null && now.abi !== null && now.abi !== abi) {
    throw new Error(`la liaison native vise l'ABI ${now.abi}, pas ${abi}`);
  }
  return { action: 'replaced', kind: now.kind, abi: now.abi };
}

module.exports = {
  ARCH_NAMES,
  MODULE,
  abiOf,
  archName,
  assetName,
  binaryKind,
  ensureBinding,
  fetchBinding,
  inspectBinding,
  kindOfFile,
};
