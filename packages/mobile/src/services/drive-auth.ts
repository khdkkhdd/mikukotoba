import { GoogleSignin } from '@react-native-google-signin/google-signin';

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
  const isSignedIn = GoogleSignin.getCurrentUser();
  if (!isSignedIn) return null;

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
