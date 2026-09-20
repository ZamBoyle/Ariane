'use strict';

/**
 * Exporting a conversation to Markdown or PDF.
 *
 * Built here, in the main process, from the index — the renderer only ever
 * names the conversation (invariant 3). The layout itself is the pure ES module
 * the renderer uses too (export-document.js, on top of format.js), so an export
 * credits every speaker exactly as the screen does.
 *
 * The side effects — which file, and how a page becomes a PDF — are passed in,
 * so everything else is testable without a window.
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const FORMATS = {
  md: { extension: 'md', name: 'Markdown' },
  pdf: { extension: 'pdf', name: 'PDF' },
};

let documentModule = null;

/** ES module shared with the renderer; imported once, on the first export. */
async function loadDocument() {
  if (!documentModule) {
    const file = path.join(__dirname, '..', 'renderer', 'export-document.js');
    documentModule = await import(pathToFileURL(file).href);
  }
  return documentModule;
}

/** A title turned into a file name every OS accepts; `fallback` when nothing is left of it. */
function fileNameFor(title, extension, fallback = 'conversation') {
  const base =
    String(title || '')
      .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^\.+/, '')
      .slice(0, 80)
      .trim() || fallback;
  return `${base}.${extension}`;
}

/**
 * @param {object} options
 * @param {import('../core/db').Index} options.index
 * @param {string} options.sessionId
 * @param {'md'|'pdf'} options.format
 * @param {boolean} [options.newestFirst] The order the screen shows this conversation in.
 * @param {(suggestedName: string, format: string) => Promise<string|null>} options.chooseFile
 *   Where to write it; null when the person cancels.
 * @param {(html: string, file: string, title: string) => Promise<void>} options.printToPdf
 * @param {object} options.l10n The app's localiser (l10n.js): an export is
 *   written in the language the app is shown in.
 * @param {Date} [options.now]
 * @returns {Promise<{saved: false} | {saved: true, path: string}>}
 */
async function exportSession({
  index,
  sessionId,
  format,
  newestFirst = false,
  chooseFile,
  printToPdf,
  l10n,
  now = new Date(),
}) {
  const kind = FORMATS[format];
  if (!kind) throw new TypeError(`unknown export format: ${format}`);

  const session = index.session(sessionId);
  if (!session) throw new Error(l10n.t('convo-not-found'));

  const doc = await loadDocument();
  const layout = doc.layoutConversation({ session, messages: index.messages(sessionId), newestFirst, l10n });

  const target = await chooseFile(fileNameFor(layout.title, kind.extension, l10n.t('export-file-name')), format);
  if (!target) return { saved: false };

  const exportedAt = now.toISOString();
  if (format === 'md') {
    await fs.promises.writeFile(target, doc.toMarkdown(layout, { exportedAt, l10n }), 'utf8');
  } else {
    await printToPdf(doc.toHtml(layout, { exportedAt, l10n }), target, layout.title);
  }
  return { saved: true, path: target };
}

/**
 * Print a page to PDF in a window nobody sees, with JavaScript switched off:
 * the page is made of conversations, and conversations hold anything anyone
 * ever pasted. The page is written to a private directory — 0700, never the
 * shared temp dir, where other accounts on the machine could read it — and
 * removed as soon as the PDF exists.
 *
 * Asynchronous from end to end: a conversation of thousands of messages makes
 * hundreds of pages, and the app must not freeze while they are laid out.
 */
async function printHtmlToPdf(html, file, title, { BrowserWindow, workDir }) {
  await fs.promises.mkdir(workDir, { recursive: true, mode: 0o700 });
  const page = path.join(workDir, `export-${process.pid}-${Date.now()}.html`);
  await fs.promises.writeFile(page, html, { encoding: 'utf8', mode: 0o600 });

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      javascript: false,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  });
  try {
    await win.loadFile(page);
    const pdf = await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: footer(title),
      margins: { top: 0.6, bottom: 0.7, left: 0.6, right: 0.6 },
    });
    await fs.promises.writeFile(file, pdf);
  } finally {
    if (!win.isDestroyed()) win.destroy();
    await fs.promises.rm(page, { force: true });
  }
}

/** Title and page number at the foot of each page. Chromium fills the two spans. */
function footer(title) {
  const safe = String(title || '')
    .slice(0, 90)
    .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  return (
    '<div style="width:100%;padding:0 12mm;font:7.5pt sans-serif;color:#97938b;' +
    'display:flex;justify-content:space-between">' +
    `<span>${safe}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`
  );
}

module.exports = { exportSession, printHtmlToPdf, fileNameFor, FORMATS };
