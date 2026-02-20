import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { useSettingsStore } from '../stores/settings-store';

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

export function configureDriveAuth(iosClientId: string) {
  GoogleSignin.configure({
    iosClientId,
    scopes: [DRIVE_SCOPE],
  });
}

export async function signIn(): Promise<{ email: string; token: string }> {
  await GoogleSignin.hasPlayServices();
  const response = await GoogleSignin.signIn();
  const tokens = await GoogleSignin.getTokens();

  const email = response.data?.user?.email ?? '';
  return { email, token: tokens.accessToken };
}

export async function signOut(): Promise<void> {
  await GoogleSignin.signOut();
}

export async function getAccessToken(): Promise<string | null> {
  const user = GoogleSignin.getCurrentUser();
  if (!user) return null;

  try {
    const tokens = await GoogleSignin.getTokens();
    return tokens.accessToken;
  } catch {
    return null;
  }
}

export async function isSignedIn(): Promise<boolean> {
  return !!GoogleSignin.getCurrentUser();
}

export async function restoreAuthState(): Promise<void> {
  try {
    const hasPrevious = GoogleSignin.hasPreviousSignIn();
    if (!hasPrevious) return;

    const user = await GoogleSignin.signInSilently();
    if (user?.data?.user?.email) {
      useSettingsStore.getState().setGoogleAccount(user.data.user.email);
    }
  } catch {
    // 복원 실패 — 무시 (사용자가 다시 로그인하면 됨)
  }
}
