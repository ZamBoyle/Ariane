/**
 * The splash screen: a picture, a box to stop seeing it, and a button to go on.
 *
 * It waits. Nothing closes it but the person — the button, the Escape key, or a
 * click on the picture. A first version closed itself as soon as the app was
 * ready: it lasted 1.7 seconds, and the box could not be ticked in time.
 *
 * It reaches three functions and no more (src/preload/splash.js): say the
 * sentences in the app's language, remember the answer, ask to be closed. No
 * index, no conversations, no filesystem — a window that opens before
 * everything else has no business reaching any of it.
 */

const box = document.getElementById('hide');
const label = document.getElementById('hide-label');
const dismiss = document.getElementById('dismiss');

window.splash
  .words()
  .then((words) => {
    label.textContent = words.hide;
    dismiss.textContent = words.dismiss;
    dismiss.focus();
  })
  .catch(() => {
    // No words, no mute box and no mute button — but Escape and the click on
    // the picture remain, so this window can never shut the app away.
    document.querySelector('.bar').hidden = true;
  });

box.addEventListener('change', () => {
  // Saved on the click, not on the close: the window may be destroyed by an
  // Escape a millisecond later.
  window.splash.keep(!box.checked).catch(() => {
    box.checked = false;
  });
});

const close = () => window.splash.close().catch(() => {});

dismiss.addEventListener('click', close);
document.getElementById('art').addEventListener('click', close);
document.addEventListener('keydown', (event) => {
  // Enter fires the focused button on its own; Escape must work anywhere.
  if (event.key === 'Escape') close();
});
