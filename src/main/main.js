'use strict';

/**
 * Electron main process: window lifecycle and security policy.
 *
 * The renderer is treated as untrusted. It has no Node integration, runs
 * sandboxed behind context isolation, and reaches the index only through the
 * narrow, validated IPC surface defined in ipc.js. Everything that touches the
 * filesystem or SQLite stays in this process.
 */

const path = require('path');
const { app, BrowserWindow, shell, session, screen, nativeTheme } = require('electron');

const { registerIpc, disposeIpc, splashEnabled } = require('./ipc');
const { WindowState } = require('./window-state');

const isDev = process.argv.includes('--dev');

/** Only these origins may ever be loaded in a window of this app. */
const ALLOWED_PROTOCOL = 'file:';

/**
 * What the window is painted with before the page has one pixel of its own.
 * These two MUST stay equal to `--bg` in styles.css, light and dark — a test
 * reads both files and compares. The theme is already decided by then:
 * registerIpc sets `nativeTheme.themeSource` from the settings before the
 * window is made, so `shouldUseDarkColors` answers for the chosen theme, not
 * only for the system's.
 */
const BACKGROUND = { dark: '#1a1915', light: '#faf9f5' };

/**
 * The splash screen.
 *
 * It waits, ON TOP of the app rather than in place of it. Two versions were
 * wrong before this one: the first closed itself once the main window was
 * ready — measured at 1.7 s on screen, too short to tick the box — and the
 * second kept the app hidden until the splash was closed, which left nothing
 * but a picture on screen.
 *
 * So: the app opens as usual, and the splash floats above it until the person
 * closes it — the button, the Escape key, or a click on the image.
 *
 * `failsafeMs` covers the one case that could strand it: a page that never
 * loads would leave a window over the app with no way to close it. If it has
 * not even managed to show itself by then, it is destroyed.
 */
const SPLASH = { width: 760, height: 470, failsafeMs: 10000 };

/** The window this app opens with, when nothing was ever saved. */
const WINDOW = { width: 1280, height: 860, minWidth: 780, minHeight: 520 };

/** How long after a drag or a resize the new geometry is written down. */
const REMEMBER_DELAY_MS = 500;

let windowState = null;

let splash = null;

function createSplash() {
  splash = new BrowserWindow({
    ...SPLASH,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    center: true,
    backgroundColor: '#0a0908',
    title: 'Ariane',
    webPreferences: {
      // Its own bridge: two functions, where the app's exposes sixty.
      preload: path.join(__dirname, '..', 'preload', 'splash.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: false,
    },
  });
  splash.setMenu(null);
  splash.loadFile(path.join(__dirname, '..', 'renderer', 'splash.html'));

  let shown = false;
  splash.once('ready-to-show', () => {
    shown = true;
    if (splash && !splash.isDestroyed()) {
      splash.show();
      // It must take the keyboard: Escape is one of the three ways out.
      splash.focus();
    }
  });

  // Nothing here may lock the app away. A page that never loads, a renderer
  // that dies: the window goes, and Ariane opens.
  splash.webContents.on('render-process-gone', dismissSplash);
  splash.on('closed', () => {
    splash = null;
    dismissSplash();
  });
  setTimeout(() => {
    if (!shown) dismissSplash();
  }, SPLASH.failsafeMs);
}

/**
 * Write down where the window is, whenever it stops moving.
 *
 * `getNormalBounds()` and not `getBounds()`: the second answers the size of the
 * screen while the window is maximised, and restoring that would give a window
 * the shape of the screen that is not maximised — one that cannot be restored
 * to anything smaller.
 */
function rememberGeometry(win) {
  let pending = null;
  const write = () => {
    if (win.isDestroyed() || win.isMinimized()) return;
    windowState.save({ ...win.getNormalBounds(), maximized: win.isMaximized() });
  };
  const later = () => {
    clearTimeout(pending);
    pending = setTimeout(write, REMEMBER_DELAY_MS);
  };

  for (const moment of ['resize', 'move', 'maximize', 'unmaximize']) win.on(moment, later);
  // A window dragged and closed in the same second must not lose the drag.
  win.on('close', () => {
    clearTimeout(pending);
    write();
  });
}

/**
 * The splash goes. Called by the person (the button, Escape, a click on the
 * image), and by the safeties above.
 */
function dismissSplash() {
  if (splash && !splash.isDestroyed()) splash.destroy();
  splash = null;
}

function createWindow() {
  const areas = screen.getAllDisplays().map((display) => display.workArea);
  const saved = windowState.bounds(WINDOW, areas);

  const win = new BrowserWindow({
    ...WINDOW,
    width: saved.width,
    height: saved.height,
    // Only when the saved position still lands on a screen that exists;
    // otherwise these stay undefined and the window is centred (window-state.js).
    ...(saved.x === undefined ? {} : { x: saved.x, y: saved.y }),
    backgroundColor: nativeTheme.shouldUseDarkColors ? BACKGROUND.dark : BACKGROUND.light,
    title: 'Ariane',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: false,
    },
  });

  rememberGeometry(win);

  // Avoid a white flash before the stylesheet applies.
  if (splashEnabled()) createSplash();
  win.once('ready-to-show', () => {
    win.show();
    // Maximised is not a size: restoring the bounds of a maximised window
    // would open a window the shape of the screen, but not maximised.
    if (saved.maximized) win.maximize();
    // The app has just been mapped above everything, so the splash asks for
    // the front again. `alwaysOnTop` alone is a request to the window manager,
    // and not every one of them honours it against a window shown after.
    if (splash && !splash.isDestroyed()) {
      splash.moveTop();
      splash.focus();
    }
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  if (isDev) win.webContents.openDevTools({ mode: 'detach' });

  // External links open in the user's browser; nothing navigates in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:$/.test(safeProtocol(url))) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (safeProtocol(url) !== ALLOWED_PROTOCOL) event.preventDefault();
  });

  // Defence in depth: the renderer needs none of these.
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false)
  );

  return win;
}

function safeProtocol(url) {
  try {
    return new URL(url).protocol;
  } catch {
    return '';
  }
}

/**
 * Content-Security-Policy applied to every response.
 *
 * The UI ships no external assets and evaluates no remote code, so the policy
 * can be maximally strict: same-origin only, no eval, no network at all.
 */
function applyCsp() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'none'; " +
            "script-src 'self'; " +
            "style-src 'self' 'unsafe-inline'; " +
            "img-src 'self' data:; " +
            "font-src 'self'; " +
            "connect-src 'none'; " +
            "form-action 'none'; " +
            "base-uri 'none'; " +
            "frame-ancestors 'none'",
        ],
      },
    });
  });
}

// A single instance keeps one writer on the SQLite file.
if (!app.requestSingleInstanceLock()) {
  // The first instance is asked to show itself, then this one steps aside.
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();

    // No window at all means this instance is wedged - it holds the lock but
    // has nothing to show. Every later launch would then quit in silence and
    // the app would look dead, which is exactly how it behaved when a
    // windowless copy was left running. Give the lock holder a window instead.
    if (!win) {
      createWindow();
      return;
    }

    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => {
    applyCsp();
    windowState = new WindowState(app.getPath('userData'));
    registerIpc({ userDataDir: app.getPath('userData'), onSplashClose: dismissSplash });
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', disposeIpc);
}
