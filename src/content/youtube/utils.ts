/**
 * Element category for mode-based rendering.
 * - 'main': Long-form text (titles, descriptions, comments) → inline block or hover
 * - 'label': Short labels (channel names, hashtags) → inline bracket or hover
 */
export type YTElementCategory = 'main' | 'label';

export interface YTSelectorDef {
  key: string;
  selector: string;
  category: YTElementCategory;
  deferToViewport: boolean;
}

/**
 * Complete YouTube element definitions with category metadata.
 * Used by page-handler to auto-generate routes with mode-aware rendering.
 */
export const YT_SELECTOR_DEFS: YTSelectorDef[] = [
  // Watch page
  { key: 'videoTitle', selector: 'ytd-watch-metadata h1 yt-formatted-string', category: 'main', deferToViewport: false },
  { key: 'commentText', selector: '#content-text.ytd-comment-renderer', category: 'main', deferToViewport: true },
  { key: 'commentTextNew', selector: 'ytd-comment-view-model #content-text', category: 'main', deferToViewport: true },
  { key: 'commentAuthor', selector: '#author-text yt-formatted-string', category: 'label', deferToViewport: true },
  { key: 'channelName', selector: '#channel-name yt-formatted-string', category: 'label', deferToViewport: false },
  { key: 'hashtag', selector: 'ytd-watch-metadata #super-title a', category: 'label', deferToViewport: false },
  { key: 'compactVideoTitle', selector: 'ytd-compact-video-renderer #video-title', category: 'label', deferToViewport: true },
  { key: 'chapterTitle', selector: 'ytd-macro-markers-list-item-renderer #details h4', category: 'label', deferToViewport: true },

  // Feed (Home/Subscriptions/Trending)
  { key: 'feedVideoTitle', selector: 'ytd-rich-grid-media #video-title-link yt-formatted-string', category: 'label', deferToViewport: true },
  { key: 'feedChannelName', selector: 'ytd-rich-grid-media ytd-channel-name yt-formatted-string', category: 'label', deferToViewport: true },
  { key: 'shortsTitle', selector: 'ytd-reel-item-renderer #shorts-title', category: 'label', deferToViewport: true },

  // New view-model components (2025+ YouTube redesign)
  { key: 'lockupTitle', selector: 'a.yt-lockup-metadata-view-model__title', category: 'label', deferToViewport: true },
  { key: 'lockupChannel', selector: 'yt-content-metadata-view-model span.yt-content-metadata-view-model__metadata-text', category: 'label', deferToViewport: true },
  { key: 'shortsLockup', selector: 'ytm-shorts-lockup-view-model-v2 h3 a, ytm-shorts-lockup-view-model h3 a', category: 'label', deferToViewport: true },

  // Search
  { key: 'searchVideoTitle', selector: 'ytd-video-renderer #video-title yt-formatted-string', category: 'main', deferToViewport: true },
  { key: 'searchDescription', selector: 'ytd-video-renderer #description-text yt-formatted-string', category: 'main', deferToViewport: true },
  { key: 'searchChannelDesc', selector: 'ytd-channel-renderer #description yt-formatted-string', category: 'main', deferToViewport: true },
  { key: 'searchPlaylist', selector: 'ytd-playlist-renderer #video-title yt-formatted-string', category: 'main', deferToViewport: true },

  // Channel
  { key: 'channelHeaderName', selector: '#channel-header #channel-name yt-formatted-string', category: 'label', deferToViewport: false },
  { key: 'channelTagline', selector: '#channel-header #channel-tagline yt-formatted-string', category: 'main', deferToViewport: false },
  { key: 'channelAbout', selector: 'ytd-channel-about-metadata-renderer #description', category: 'main', deferToViewport: true },
  { key: 'communityPost', selector: 'ytd-backstage-post-thread-renderer #content-text', category: 'main', deferToViewport: true },
  { key: 'pollOption', selector: 'ytd-backstage-poll-renderer #vote-text', category: 'label', deferToViewport: true },
  { key: 'channelPlaylistTitle', selector: 'ytd-grid-playlist-renderer #video-title yt-formatted-string', category: 'label', deferToViewport: true },

  // Playlist
  { key: 'playlistTitle', selector: 'ytd-playlist-header-renderer #title yt-formatted-string', category: 'main', deferToViewport: false },
  { key: 'playlistDesc', selector: 'ytd-playlist-header-renderer #description yt-formatted-string', category: 'main', deferToViewport: true },
  { key: 'playlistVideo', selector: 'ytd-playlist-video-renderer #video-title', category: 'label', deferToViewport: true },

  // Shorts
  { key: 'shortsDesc', selector: 'ytd-reel-video-renderer #reel-description-text', category: 'main', deferToViewport: true },
  { key: 'shortsChannel', selector: 'ytd-reel-video-renderer ytd-channel-name yt-formatted-string', category: 'label', deferToViewport: true },
  { key: 'shortsComment', selector: 'ytd-reel-video-renderer ytd-comment-renderer #content-text, ytd-reel-video-renderer ytd-comment-view-model #content-text', category: 'main', deferToViewport: true },
];

/**
 * YouTube-specific CSS selectors for page translation.
 * @deprecated Use YT_SELECTOR_DEFS for new code. Kept for description watcher compatibility.
 */
export const YT_SELECTORS = {
  // Watch page
  VIDEO_TITLE: 'ytd-watch-metadata h1 yt-formatted-string',
  DESCRIPTION: 'ytd-text-inline-expander #structured-description',
  DESCRIPTION_EXPANDER: '#description-inner > ytd-text-inline-expander',
  COMMENT_TEXT: '#content-text.ytd-comment-renderer',
  COMMENT_TEXT_NEW: 'ytd-comment-view-model #content-text',
  COMMENT_AUTHOR: '#author-text yt-formatted-string',
  CHANNEL_NAME: '#channel-name yt-formatted-string',
  HASHTAG: 'ytd-watch-metadata #super-title a',
  COMPACT_VIDEO_TITLE: 'ytd-compact-video-renderer #video-title',
  CHAPTER_TITLE: 'ytd-macro-markers-list-item-renderer #details h4',

  // Feed (Home/Subscriptions)
  FEED_VIDEO_TITLE: 'ytd-rich-grid-media #video-title-link yt-formatted-string',
  FEED_CHANNEL_NAME: 'ytd-rich-grid-media ytd-channel-name yt-formatted-string',
  SHORTS_TITLE: 'ytd-reel-item-renderer #shorts-title',

  // New view-model components (2025+ YouTube redesign)
  LOCKUP_TITLE: 'a.yt-lockup-metadata-view-model__title',
  LOCKUP_CHANNEL: 'yt-content-metadata-view-model span.yt-content-metadata-view-model__metadata-text',
  SHORTS_LOCKUP: 'ytm-shorts-lockup-view-model-v2 h3 a, ytm-shorts-lockup-view-model h3 a',

  // Search
  SEARCH_VIDEO_TITLE: 'ytd-video-renderer #video-title yt-formatted-string',
  SEARCH_DESCRIPTION: 'ytd-video-renderer #description-text yt-formatted-string',
  SEARCH_CHANNEL_DESC: 'ytd-channel-renderer #description yt-formatted-string',
  SEARCH_PLAYLIST: 'ytd-playlist-renderer #video-title yt-formatted-string',

  // Channel
  CHANNEL_HEADER_NAME: '#channel-header #channel-name yt-formatted-string',
  CHANNEL_TAGLINE: '#channel-header #channel-tagline yt-formatted-string',
  CHANNEL_ABOUT: 'ytd-channel-about-metadata-renderer #description',
  COMMUNITY_POST: 'ytd-backstage-post-thread-renderer #content-text',
  POLL_OPTION: 'ytd-backstage-poll-renderer #vote-text',
  CHANNEL_PLAYLIST_TITLE: 'ytd-grid-playlist-renderer #video-title yt-formatted-string',

  // Playlist
  PLAYLIST_TITLE: 'ytd-playlist-header-renderer #title yt-formatted-string',
  PLAYLIST_DESC: 'ytd-playlist-header-renderer #description yt-formatted-string',
  PLAYLIST_VIDEO: 'ytd-playlist-video-renderer #video-title',

  // Shorts
  SHORTS_DESC: 'ytd-reel-video-renderer #reel-description-text',
  SHORTS_CHANNEL: 'ytd-reel-video-renderer ytd-channel-name yt-formatted-string',
  SHORTS_COMMENT: 'ytd-reel-video-renderer ytd-comment-renderer #content-text',
} as const;

/** Attribute used to mark injected YouTube translation elements */
export const YT_TRANSLATION_ATTR = 'data-jp-yt-translation';

/** Attribute to mark processed YouTube source elements */
export const YT_PROCESSED_ATTR = 'data-jp-yt-processed';
