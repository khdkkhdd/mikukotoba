import { isJapanese } from '@/content/shared/dom-utils';
export { isJapaneseShortText } from '@/content/shared/dom-utils';

/**
 * Twitter-specific stable selectors (data-testid based).
 * CSS classes are obfuscated and change per build — never use them.
 */
export const SELECTORS = {
  // Tweet elements
  TWEET: 'article[data-testid="tweet"]',
  TWEET_TEXT: '[data-testid="tweetText"]',
  CARD_WRAPPER: '[data-testid="card.wrapper"]',
  SOCIAL_CONTEXT: '[data-testid="socialContext"]',

  // User elements
  USER_NAME: '[data-testid="User-Name"]',         // timeline (with hyphen)
  USER_NAME_PROFILE: '[data-testid="UserName"]',   // profile header (no hyphen)
  USER_DESCRIPTION: '[data-testid="UserDescription"]',
  USER_LOCATION: '[data-testid="UserLocation"]',
  USER_CELL: '[data-testid="UserCell"]',

  // Trending
  TREND: '[data-testid="trend"]',

  // Containers
  PRIMARY_COLUMN: '[data-testid="primaryColumn"]',
  SIDEBAR_COLUMN: '[data-testid="sidebarColumn"]',

  // Excluded
  TWEET_TEXTAREA: '[data-testid^="tweetTextarea"]',
  USER_URL: '[data-testid="UserUrl"]',
  USER_JOIN_DATE: '[data-testid="UserJoinDate"]',
  USER_BIRTHDATE: '[data-testid="UserBirthdate"]',
} as const;

/** Attribute used to mark injected translation elements */
export const TRANSLATION_ATTR = 'data-jp-twitter-translation';

/** Attribute to mark processed source elements */
export const PROCESSED_ATTR = 'data-jp-twitter-processed';

/**
 * Check if a text element is Japanese.
 * Uses lang="ja" attribute first (zero-cost), falls back to character detection.
 */
export function isJapaneseText(element: HTMLElement): boolean {
  // Fast path: lang attribute
  if (element.getAttribute('lang') === 'ja') return true;
  // Walk up to check parent lang
  const langEl = element.closest('[lang="ja"]');
  if (langEl) return true;

  const text = element.innerText?.trim();
  if (!text) return false;
  return isJapanese(text);
}

/**
 * Extract tweet permalink URL as cache key.
 * Finds the <time> element's parent <a> inside the tweet article.
 */
export function getTweetCacheKey(tweetText: HTMLElement): string | null {
  const article = tweetText.closest(SELECTORS.TWEET);
  if (!article) return null;

  const timeEl = article.querySelector('time');
  if (!timeEl) return null;

  const link = timeEl.closest('a');
  return link?.getAttribute('href') || null;
}

/**
 * Extract the @handle from a User-Name element.
 */
export function getUserHandle(userNameEl: HTMLElement): string | null {
  // The @handle is in a separate span that starts with @
  const spans = userNameEl.querySelectorAll('span');
  for (const span of spans) {
    const text = span.textContent?.trim();
    if (text?.startsWith('@')) return text;
  }
  return null;
}

/**
 * Extract display name text from a User-Name element.
 * Returns only the display name part (first link's text), not the @handle.
 */
export function getDisplayName(userNameEl: HTMLElement): string | null {
  // Display name is in the first <a> tag inside User-Name
  const firstLink = userNameEl.querySelector('a');
  if (!firstLink) return null;

  // Get only direct text, excluding badge images etc.
  const nameSpan = firstLink.querySelector('span');
  return nameSpan?.innerText?.trim() || null;
}

/**
 * Extract card link URL for cache key.
 */
export function getCardCacheKey(cardWrapper: HTMLElement): string | null {
  const link = cardWrapper.querySelector('a[href]');
  return link?.getAttribute('href') || null;
}

/**
 * Check if an element is inside an editable area (tweet composer, etc.)
 */
export function isEditableArea(element: HTMLElement): boolean {
  return !!element.closest(
    '[contenteditable="true"], [contenteditable=""], [role="textbox"], [role="combobox"], ' +
    SELECTORS.TWEET_TEXTAREA
  );
}

/**
 * Check if an element has already been processed by our handler.
 */
export function isAlreadyProcessed(element: HTMLElement): boolean {
  return element.hasAttribute(PROCESSED_ATTR);
}

/**
 * Mark an element as processed.
 */
export function markProcessed(element: HTMLElement): void {
  element.setAttribute(PROCESSED_ATTR, 'true');
}

/**
 * Remove any existing translation block adjacent to an element.
 */
export function removeExistingTranslation(element: HTMLElement): void {
  const next = element.nextElementSibling;
  if (next?.hasAttribute(TRANSLATION_ATTR)) {
    next.remove();
  }
}

/**
 * Create a simple hash from text for cache keys.
 */
export function textHash(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + ch;
    hash |= 0;
  }
  return hash.toString(36);
}
