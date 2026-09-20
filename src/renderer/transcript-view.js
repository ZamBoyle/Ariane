/**
 * The transcript, painted in slices so that a conversation of any length
 * opens at once.
 *
 * Measured on a real corpus: the largest conversation holds 6 642 messages,
 * and building all their rows in one go froze the window for 783 ms. Reading
 * them (108 ms), grouping them (4 ms) and rendering their markdown (20 ms) were
 * never the problem — creating six thousand DOM nodes in one task was. So the
 * first slice, which is what fills the screen, is painted immediately, and the
 * rest follows in small slices while the app is otherwise idle.
 *
 * Two things must never wait for those slices, and this module exists to hold
 * both: a search hit deep in the conversation is rendered up to before it is
 * scrolled to, and a message arriving in the open conversation adds its row
 * without repainting the six thousand others.
 */

/** Rows painted at once: comfortably more than a screen holds. */
const FIRST_SLICE = 120;
/** Rows per idle slice: about 30 ms of work each, short enough to stay responsive. */
const SLICE = 250;

const idle = (fn) =>
  typeof window.requestIdleCallback === 'function'
    ? window.requestIdleCallback(fn, { timeout: 250 })
    : setTimeout(fn, 0);

/** Every message id a group stands for: one message, or a whole strip of tool calls. */
const idsOf = (group) =>
  group.type === 'toolRun' ? group.messages.map((m) => m.id) : [group.message.id];

export class TranscriptView {
  /**
   * @param {HTMLElement} container
   * @param {(group: object) => HTMLElement} renderGroup
   * @param {{emptyText?: string, firstSlice?: number, slice?: number}} [options]
   */
  constructor(container, renderGroup, options = {}) {
    this.container = container;
    this.renderGroup = renderGroup;
    this.emptyText = options.emptyText || '';
    this.firstSlice = options.firstSlice || FIRST_SLICE;
    this.slice = options.slice || SLICE;
    /** Groups in chronological order; `display` is the order on screen. */
    this.groups = [];
    this.newestFirst = false;
    this.rendered = 0;
    this.token = 0;
  }

  /** Every group, in the order they stand on screen — painted or not yet. */
  get display() {
    return this.newestFirst ? [...this.groups].reverse() : this.groups;
  }

  /** How many rows are on screen, and how many there will be. */
  get progress() {
    return { rendered: this.rendered, total: this.groups.length };
  }

  /** Display index `d` → chronological index. */
  #chrono(d) {
    return this.newestFirst ? this.groups.length - 1 - d : d;
  }

  /**
   * Replace everything. Only the first slice is painted now; the rest follows.
   * @param {object[]} groups  In chronological order, as groupMessages returns them.
   */
  show(groups, { newestFirst = false } = {}) {
    this.token += 1;
    this.groups = groups;
    this.newestFirst = newestFirst;
    this.rendered = 0;
    this.container.replaceChildren();

    if (groups.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'tree-empty';
      empty.textContent = this.emptyText;
      this.container.append(empty);
      return;
    }

    this.#paintUntil(this.firstSlice);
    this.#continue();
  }

  /**
   * The row standing for message `id`, painting every row before it first if
   * it is not on screen yet. Null when no row stands for it.
   */
  rowOf(id) {
    const chrono = this.groups.findIndex((g) => idsOf(g).includes(id));
    if (chrono < 0) return null;
    const display = this.newestFirst ? this.groups.length - 1 - chrono : chrono;
    this.#paintUntil(display + 1);
    return this.container.children[display] || null;
  }

  /**
   * Messages were appended to the conversation: add their rows, and nothing
   * else. Adding at the end of a conversation can only change its last group —
   * a strip of tool calls that goes on — and add new ones after it; every other
   * row stays exactly as the reader left it, unfolded strips included.
   */
  extend(groups) {
    // Nothing was on screen but the "empty" notice, and no slice is running.
    if (this.groups.length === 0) return this.show(groups, { newestFirst: this.newestFirst });

    const keep = Math.max(0, this.groups.length - 1);
    const lastWasPainted = this.#chronoPainted(this.groups.length - 1);
    this.groups = groups;

    if (!lastWasPainted) return; // still to come: the slices will paint the new tail

    const tail = groups.slice(keep).map((group) => this.renderGroup(group));
    if (this.newestFirst) {
      // The newest rows are at the top: the old last group is the first child.
      this.container.firstElementChild?.remove();
      this.container.prepend(...tail.reverse());
    } else {
      this.container.lastElementChild?.remove();
      this.container.append(...tail);
    }
    this.rendered += tail.length - 1;
  }

  /** Something else takes the pane: slices still pending must not paint into it. */
  detach() {
    this.token += 1;
    this.groups = [];
    this.rendered = 0;
  }

  #chronoPainted(chrono) {
    if (chrono < 0) return false;
    const display = this.newestFirst ? this.groups.length - 1 - chrono : chrono;
    return display < this.rendered;
  }

  #paintUntil(end) {
    const stop = Math.min(end, this.groups.length);
    if (stop <= this.rendered) return;
    const fragment = document.createDocumentFragment();
    for (let d = this.rendered; d < stop; d++) fragment.append(this.renderGroup(this.groups[this.#chrono(d)]));
    this.container.append(fragment);
    this.rendered = stop;
  }

  /** The rest, a slice at a time, until done or until something else is shown. */
  #continue() {
    const token = this.token;
    const step = () => {
      if (token !== this.token || this.rendered >= this.groups.length) return;
      this.#paintUntil(this.rendered + this.slice);
      if (this.rendered < this.groups.length) idle(step);
    };
    idle(step);
  }
}
