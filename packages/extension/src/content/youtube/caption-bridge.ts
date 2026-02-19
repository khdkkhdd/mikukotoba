/**
 * MAIN world bridge script.
 * Runs in the page's JS context so it can access YouTube's player API.
 * Communicates with the isolated-world content script via window events.
 */

interface YTPlayer extends HTMLElement {
  getPlayerResponse?: () => {
    captions?: {
      playerCaptionsTracklistRenderer?: {
        captionTracks?: unknown[];
      };
    };
  };
  getOption?: (module: string, option: string) => unknown;
  setOption?: (module: string, option: string, value: unknown) => void;
  loadModule?: (module: string) => void;
}

/**
 * Return caption track metadata from the player response.
 */
window.addEventListener('jp-helper-get-tracks', () => {
  let tracks: unknown[] = [];
  try {
    const player = document.getElementById('movie_player') as YTPlayer | null;
    if (player?.getPlayerResponse) {
      const resp = player.getPlayerResponse();
      tracks =
        resp?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    }

    if (!tracks.length) {
      const yt = (window as unknown as Record<string, unknown>)
        .ytInitialPlayerResponse as {
        captions?: {
          playerCaptionsTracklistRenderer?: { captionTracks?: unknown[] };
        };
      } | undefined;
      if (yt) {
        tracks =
          yt.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
      }
    }
  } catch {
    // ignore
  }

  window.dispatchEvent(
    new CustomEvent('jp-helper-tracks-response', {
      detail: JSON.stringify(tracks),
    }),
  );
});

/**
 * Programmatically enable a caption track on the YouTube player.
 * This loads the subtitle data into HTML5 TextTrack API.
 */
window.addEventListener('jp-helper-enable-captions', (e: Event) => {
  let success = false;
  let info = '';
  try {
    const player = document.getElementById('movie_player') as YTPlayer | null;
    if (!player) {
      info = 'no player';
    } else {
      // Ensure captions module is loaded
      player.loadModule?.('captions');

      // Get available tracks from player's caption option
      const tracklist = player.getOption?.('captions', 'tracklist') as
        | Array<{ languageCode: string; kind?: string; displayName?: string }>
        | undefined;

      if (!tracklist || tracklist.length === 0) {
        info = 'no tracklist';
      } else {
        const lang = (e as CustomEvent).detail || 'ja';

        // Prefer manual track, then ASR
        const track =
          tracklist.find((t) => t.languageCode === lang && t.kind !== 'asr') ||
          tracklist.find((t) => t.languageCode === lang);

        if (track) {
          player.setOption?.('captions', 'track', track);
          success = true;
          info = `enabled: ${track.displayName || track.languageCode}(${track.kind || 'manual'})`;
        } else {
          info =
            'no ja track in: ' +
            tracklist.map((t) => `${t.languageCode}(${t.kind || 'manual'})`).join(', ');
        }
      }
    }
  } catch (err) {
    info = 'error: ' + String(err);
  }

  window.dispatchEvent(
    new CustomEvent('jp-helper-captions-enabled', {
      detail: JSON.stringify({ success, info }),
    }),
  );
});

/**
 * Fetch a URL from the page's same-origin context.
 */
window.addEventListener('jp-helper-fetch-url', (e: Event) => {
  const { url, id } = JSON.parse((e as CustomEvent).detail);
  fetch(url)
    .then(async (r) => {
      const text = await r.text();
      window.dispatchEvent(
        new CustomEvent('jp-helper-fetch-response', {
          detail: JSON.stringify({ id, status: r.status, text }),
        }),
      );
    })
    .catch((err) => {
      window.dispatchEvent(
        new CustomEvent('jp-helper-fetch-response', {
          detail: JSON.stringify({ id, status: 0, text: '', error: String(err) }),
        }),
      );
    });
});
