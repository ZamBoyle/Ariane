'use strict';

/**
 * Builds a safe FTS5 MATCH expression from free-form user input.
 *
 * FTS5 has its own query syntax: bare input like `it's` or a dangling `AND`
 * raises "fts5: syntax error", and `*`/`^`/`:`/`-` carry special meaning. Rather
 * than surface those errors to someone typing in a search box, every token is
 * quoted as a literal phrase and combined with AND.
 *
 * Quoted phrases from the user are honoured: `"tool use" index` searches the
 * exact phrase plus the term. The final token gets a prefix wildcard so results
 * appear while typing.
 */

/** FTS5 treats these as operators; they never survive into a literal token. */
const SPECIAL = /[()"*^:{}[\]~]/g;

/** NUL and friends: never typed on purpose, and fatal to a prepared statement. */
const CONTROL = /[\u0000-\u001f\u007f]/g;

/**
 * @param {string} input
 * @param {{prefix?: boolean}} [options] prefix: match the last token as a prefix.
 * @returns {string} A MATCH expression, or '' when the input has no usable term.
 */
function toMatchQuery(input, options = {}) {
  const { prefix = true } = options;
  if (typeof input !== 'string') return '';

  const tokens = tokenize(input);
  if (tokens.length === 0) return '';

  return tokens
    .map((token, i) => {
      const literal = `"${token.replace(/"/g, '""')}"`;
      const isLast = i === tokens.length - 1;
      // A prefix wildcard is only meaningful on a single-word token.
      return prefix && isLast && !token.includes(' ') ? `${literal} *` : literal;
    })
    .join(' AND ')
    .replace(/" \*/g, '"*');
}

/** Split input into literal tokens, honouring "quoted phrases". */
function tokenize(input) {
  const tokens = [];
  const phrase = /"([^"]*)"/g;
  let rest = input;

  let match;
  while ((match = phrase.exec(input)) !== null) {
    const value = sanitize(match[1]);
    if (value) tokens.push(value);
  }
  rest = input.replace(phrase, ' ');

  for (const word of rest.split(/\s+/)) {
    const value = sanitize(word);
    if (value) tokens.push(value);
  }
  return tokens;
}

function sanitize(value) {
  return value
    // Control bytes reach SQLite as a premature end of string and raise
    // "unterminated string" out of prepare(), past the MATCH guard in db.search.
    .replace(CONTROL, ' ')
    .replace(SPECIAL, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = { toMatchQuery, tokenize };
