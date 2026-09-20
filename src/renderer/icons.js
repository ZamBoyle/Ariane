/**
 * The app's icons: one family, drawn here once — outline strokes on a 24-unit
 * grid, the colour of the text around them.
 *
 * Built as DOM nodes rather than loaded: nothing to fetch, nothing to allow in
 * the CSP, and no markup string anywhere near innerHTML. Every icon is
 * decorative — aria-hidden — because the button it sits in always carries its
 * own name, in its label or in aria-label.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Each icon is a list of path data, stroked with round caps and joins. */
const PATHS = {
  refresh: [
    'M3 12a9 9 0 0 1 15.3-6.4L21 8',
    'M21 3v5h-5',
    'M21 12a9 9 0 0 1-15.3 6.4L3 16',
    'M8 16H3v5',
  ],
  // Latest at the top: an arrow up beside lines that narrow as they climb.
  sortNewest: ['m3 8 4-4 4 4', 'M7 4v16', 'M11 8h4', 'M11 12h7', 'M11 16h10'],
  // First at the top: the arrow points down the reading order.
  sortOldest: ['m3 16 4 4 4-4', 'M7 20V4', 'M11 8h10', 'M11 12h7', 'M11 16h4'],
  download: ['M12 4v11', 'm7 10 5 5 5-5', 'M5 20h14'],
  fileText: ['M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z', 'M14 3v6h6', 'M8 13h8', 'M8 17h5'],
  printer: [
    'M6 9V3h12v6',
    'M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2',
    'M6 14h12v7H6z',
  ],
  terminal: ['m4 17 6-6-6-6', 'M12 19h8'],
  copy: ['M9 9h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z', 'M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1'],
  check: ['M20 6 9 17l-5-5'],
  folderOpen: [
    'm6 14 1.5-2.9A2 2 0 0 1 9.2 10H20a2 2 0 0 1 1.9 2.5l-1.5 6a2 2 0 0 1-1.9 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.7.9l.8 1.2a2 2 0 0 0 1.7.9H18a2 2 0 0 1 2 2v2',
  ],
  trash: ['M3 6h18', 'M8 6V4h8v2', 'm19 6-1 14H6L5 6', 'M10 11v6', 'M14 11v6'],
  search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'm20 20-4-4'],
  chevronUp: ['m18 15-6-6-6 6'],
  chevronDown: ['m6 9 6 6 6-6'],
  close: ['M18 6 6 18', 'm6 6 12 12'],
  plus: ['M12 5v14', 'M5 12h14'],
  // The star, and the same star filled: a mark the eye finds without reading.
  star: ['m12 3.5 2.6 5.3 5.9.9-4.25 4.15 1 5.85L12 16.9l-5.25 2.8 1-5.85L3.5 9.7l5.9-.9z'],
  note: ['M4 5h16', 'M4 10h16', 'M4 15h10', 'M4 20h6'],
  settings: [
    'M12.2 2h-.4a2 2 0 0 0-2 2v.2a2 2 0 0 1-1 1.7l-.4.3a2 2 0 0 1-2 0l-.2-.1a2 2 0 0 0-2.7.7l-.2.4a2 2 0 0 0 .7 2.7l.2.1a2 2 0 0 1 1 1.7v.5a2 2 0 0 1-1 1.8l-.2.1a2 2 0 0 0-.7 2.7l.2.4a2 2 0 0 0 2.7.7l.2-.1a2 2 0 0 1 2 0l.4.3a2 2 0 0 1 1 1.7v.2a2 2 0 0 0 2 2h.4a2 2 0 0 0 2-2v-.2a2 2 0 0 1 1-1.7l.4-.3a2 2 0 0 1 2 0l.2.1a2 2 0 0 0 2.7-.7l.2-.4a2 2 0 0 0-.7-2.7l-.2-.1a2 2 0 0 1-1-1.8v-.5a2 2 0 0 1 1-1.7l.2-.1a2 2 0 0 0 .7-2.7l-.2-.4a2 2 0 0 0-2.7-.7l-.2.1a2 2 0 0 1-2 0l-.4-.3a2 2 0 0 1-1-1.7V4a2 2 0 0 0-2-2z',
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  ],
};

/**
 * @param {string} name
 * @param {{filled?: boolean}} [options] filled: paint the shape rather than
 *   outline it — the starred state, told by more than a colour.
 * @returns {SVGSVGElement}
 */
export function icon(name, { filled = false } = {}) {
  const paths = PATHS[name];
  if (!paths) throw new Error(`unknown icon: ${name}`);
  const svg = document.createElementNS(SVG_NS, 'svg');
  if (filled) svg.dataset.filled = 'true';
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', 'icon');
  svg.dataset.icon = name;
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

/**
 * Give a button its icon and its label — together, always. Setting a
 * button's textContent would silently drop its icon, and several labels
 * change while the app runs; this is the one way they are set.
 *
 * The label is also the button's accessible name, so that a narrow window
 * may hide it (see styles.css) without leaving a nameless button behind.
 */
export function setButton(button, { icon: name, label }) {
  const text = document.createElement('span');
  text.className = 'label';
  text.textContent = label;
  button.replaceChildren(icon(name), text);
  button.setAttribute('aria-label', label);
}

/** An icon-only button: the name lives in aria-label and in its tooltip. */
export function setIconButton(button, { icon: name, label, filled = false }) {
  button.replaceChildren(icon(name, { filled }));
  button.setAttribute('aria-label', label);
  button.title = label;
}

export const ICON_NAMES = Object.keys(PATHS);
