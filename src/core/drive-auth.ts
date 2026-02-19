import type { DriveStatus } from '@/types';

const TOKEN_KEY = 'jp_drive_token';
const CLIENT_ID_KEY = 'jp_drive_client_id';
const SCOPES = 'https://www.googleapis.com/auth/drive.appdata openid email';

interface StoredToken {
  access_token: string;
  expires_at: number;
  email?: string;
}

async function getClientId(): Promise<string> {
  const data = await chrome.storage.local.get(CLIENT_ID_KEY);
  return data[CLIENT_ID_KEY] || '';
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

export const DriveAuth = {
  async login(): Promise<DriveStatus> {
    const clientId = await getClientId();
    if (!clientId) throw new Error('OAuth Client ID가 설정되지 않았습니다.');
    const redirectUrl = getRedirectUrl();

    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUrl);
    authUrl.searchParams.set('response_type', 'token');
    authUrl.searchParams.set('scope', SCOPES);
    authUrl.searchParams.set('prompt', 'consent');

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
    try {
      const clientId = await getClientId();
      if (!clientId) return null;
      const redirectUrl = getRedirectUrl();

      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authUrl.searchParams.set('client_id', clientId);
      authUrl.searchParams.set('redirect_uri', redirectUrl);
      authUrl.searchParams.set('response_type', 'token');
      authUrl.searchParams.set('scope', SCOPES);
      authUrl.searchParams.set('prompt', 'none');

      const responseUrl = await chrome.identity.launchWebAuthFlow({
        url: authUrl.toString(),
        interactive: false,
      });

      if (!responseUrl) return null;

      const hashParams = new URLSearchParams(
        responseUrl.includes('#') ? responseUrl.split('#')[1] : ''
      );
      const accessToken = hashParams.get('access_token');
      const expiresIn = parseInt(hashParams.get('expires_in') || '3600', 10);

      if (!accessToken) return null;

      await storeToken({
        access_token: accessToken,
        expires_at: Date.now() + expiresIn * 1000 - 60_000,
        email: token.email,
      });

      return accessToken;
    } catch {
      // Silent re-auth failed
      await clearToken();
      return null;
    }
  },

  async getStatus(): Promise<DriveStatus> {
    const token = await getStoredToken();
    if (!token) return { loggedIn: false };

    const isValid = Date.now() < token.expires_at;
    return {
      loggedIn: isValid,
      email: isValid ? token.email : undefined,
    };
  },
};
