/**
 * Add click-to-reveal behavior to a spoiler element.
 *
 * The element should have class `jp-spoiler` which applies blur.
 * Clicking toggles `jp-revealed` which removes the blur.
 *
 * Extracted from tweet-handler, user-handler, and trend-handler
 * where the same 3-line pattern was duplicated.
 */
export function addSpoilerBehavior(el: HTMLElement): void {
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    el.classList.toggle('jp-revealed');
  });
}
