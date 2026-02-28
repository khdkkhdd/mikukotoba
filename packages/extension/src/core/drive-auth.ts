import type { DriveStatus } from '@/types';
import { createLogger } from '@/core/logger';

const log = createLogger('DriveAuth');
const TOKEN_KEY = 'jp_drive_token';
const CLIENT_ID = '582194695290-ggtpq96agm47347seh50ro8qt105dsm0.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/drive.appdata openid email';

interface StoredToken {
  access_token: string;
  expires_at: number;
  email?: string;
}

function getRedirectUrl(): string {
  return chrome.identity.getRedirectURL();
}

async function getStoredToken(): Promise<StoredToken | null> {
  const data = await chrome.storage.local.get(TOKEN_KEY);
  return data[TOKEN_KEY] || null;
}

async function storeToken(token: StoredToken): Promise<void> {
  await chrome.storage.local.set({ [TOKEN_KEY]: token });
}

async function clearToken(): Promise<void> {
  await chrome.storage.local.remove(TOKEN_KEY);
}

async function fetchUserEmail(accessToken: string): Promise<string> {
  const resp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) throw new Error(`userinfo failed: ${resp.status}`);
  const info = await resp.json();
  return info.email || '';
}

/** 권한 자체가 취소된 영구 에러 — 토큰 삭제 필요 */
const PERMANENT_ERRORS = new Set(['access_denied', 'invalid_scope']);

/**
 * Silent refresh: prompt=none으로 새 토큰 획득 시도.
 * - 성공 → 새 access_token 반환
 * - 영구 에러 (access_denied 등) → 토큰 삭제, null 반환
 * - 세션 만료 (interaction_required 등) / 일시적 에러 → 토큰 유지, null 반환
 */
async function silentRefresh(token: StoredToken): Promise<string | null> {
  try {
    const redirectUrl = getRedirectUrl();

    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', redirectUrl);
    authUrl.searchParams.set('response_type', 'token');
    authUrl.searchParams.set('scope', SCOPES);
    authUrl.searchParams.set('prompt', 'none');
    if (token.email) {
      authUrl.searchParams.set('login_hint', token.email);
    }

    log.info('silentRefresh: attempting, email:', token.email || '(none)');

    const responseUrl = await chrome.identity.launchWebAuthFlow({
      url: authUrl.toString(),
      interactive: false,
    });

    if (!responseUrl) {
      log.info('silentRefresh: no responseUrl');
      return null;
    }

    // error 파라미터 확인 (Google이 fragment에 에러 반환)
    const hashParams = new URLSearchParams(
      responseUrl.includes('#') ? responseUrl.split('#')[1] : ''
    );
    const error = hashParams.get('error');
    if (error) {
      log.info('silentRefresh: error:', error);
      if (PERMANENT_ERRORS.has(error)) {
        await clearToken();
      }
      return null;
    }

    const accessToken = hashParams.get('access_token');
    const expiresIn = parseInt(hashParams.get('expires_in') || '3600', 10);

    if (!accessToken) {
      log.info('silentRefresh: no access_token in response');
      return null;
    }

    await storeToken({
      access_token: accessToken,
      expires_at: Date.now() + expiresIn * 1000 - 60_000,
      email: token.email,
    });

    log.info('silentRefresh: OK, expires_in:', expiresIn);
    return accessToken;
  } catch (err) {
    log.info('silentRefresh: exception:', String(err));
    return null;
  }
}

export const DriveAuth = {
  async login(): Promise<DriveStatus> {
    const redirectUrl = getRedirectUrl();

    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', redirectUrl);
    authUrl.searchParams.set('response_type', 'token');
    authUrl.searchParams.set('scope', SCOPES);
    authUrl.searchParams.set('prompt', 'select_account');

    const responseUrl = await chrome.identity.launchWebAuthFlow({
      url: authUrl.toString(),
      interactive: true,
    });

    if (!responseUrl) {
      throw new Error('Auth flow cancelled');
    }

    // Extract token from redirect URL fragment
    const hashParams = new URLSearchParams(
      responseUrl.includes('#') ? responseUrl.split('#')[1] : ''
    );
    const accessToken = hashParams.get('access_token');
    const expiresIn = parseInt(hashParams.get('expires_in') || '3600', 10);

    if (!accessToken) {
      throw new Error('No access token in response');
    }

    const email = await fetchUserEmail(accessToken);

    const token: StoredToken = {
      access_token: accessToken,
      expires_at: Date.now() + expiresIn * 1000 - 60_000, // 1분 여유
      email,
    };
    await storeToken(token);

    return { loggedIn: true, email };
  },

  async logout(): Promise<void> {
    const token = await getStoredToken();
    if (token?.access_token) {
      // Revoke token (best effort)
      fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token.access_token}`)
        .catch(() => {});
    }
    await clearToken();
  },

  async getValidToken(): Promise<string | null> {
    const token = await getStoredToken();
    if (!token) return null;

    // Token still valid
    if (Date.now() < token.expires_at) {
      return token.access_token;
    }

    // Token expired — try silent re-auth
    return silentRefresh(token);
  },

  async getStatus(): Promise<DriveStatus> {
    const token = await getStoredToken();
    if (!token) return { loggedIn: false };

    // 토큰이 아직 유효하면 바로 반환
    if (Date.now() < token.expires_at) {
      return { loggedIn: true, email: token.email };
    }

    // 만료된 토큰 → silent refresh 시도
    await silentRefresh(token);

    // 토큰이 삭제되지 않았으면 (영구 에러가 아니면) 로그인 유지
    const current = await getStoredToken();
    if (current) {
      return { loggedIn: true, email: current.email };
    }
    return { loggedIn: false };
  },
};
