/**
 * Put the words on the page: every element that carries `data-l10n-id` gets
 * its message's text, and those of its attributes a person reads or hears.
 *
 * The same convention as Fluent's own DOM bindings: the markup names the
 * message, the language file holds the words. index.html therefore holds no
 * sentence at all — only ids — and a page shown in any language is built the
 * same way.
 */

/** Attributes a message may set. Anything else in a translation is ignored, never applied. */
const ALLOWED_ATTRIBUTES = new Set(['title', 'aria-label', 'placeholder', 'alt']);

/**
 * @param {ParentNode} root
 * @param {{message: (id: string, args?: object) => {value: string|null, attributes: object}}} l10n
 */
export function localize(root, l10n) {
  const elements = root.querySelectorAll('[data-l10n-id]');
  for (const element of elements) localizeElement(element, l10n);
}

export function localizeElement(element, l10n) {
  let args;
  try {
    args = element.dataset.l10nArgs ? JSON.parse(element.dataset.l10nArgs) : undefined;
  } catch {
    args = undefined;
  }
  const { value, attributes } = l10n.message(element.dataset.l10nId, args);
  // textContent, as everywhere: a translation is text, never markup.
  if (value !== null) element.textContent = value;
  for (const [name, text] of Object.entries(attributes)) {
    if (ALLOWED_ATTRIBUTES.has(name)) element.setAttribute(name, text);
  }
}
