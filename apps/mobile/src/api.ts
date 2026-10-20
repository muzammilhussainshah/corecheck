import { Platform } from 'react-native';
import * as Keychain from 'react-native-keychain';
import {
  type ApiError,
  type ChangePinInput,
  ERROR_CODES,
  type LoginResponse,
  type MeResponse,
  type PocEvidence,
  type PocMutation,
  type PocPullResponse,
  type PocPushResponse,
} from '@corecheck/shared';
import { getSetting, setSetting } from './db';

/**
 * The API as the device sees it. An Android emulator reaches the computer at
 * 10.0.2.2; a physical phone needs the computer's LAN address, which can be
 * set on the sign-in screen.
 */
export const DEFAULT_SERVER =
  Platform.OS === 'android' ? 'http://10.0.2.2:4000' : 'http://localhost:4000';

export const getServer = async () =>
  (await getSetting('server')) ?? DEFAULT_SERVER;
export const setServer = (url: string) =>
  setSetting('server', url.replace(/\/+$/, ''));

const TOKEN_SERVICE = 'corecheck.session';

/** The session token lives in the Keychain / Android Keystore, never in plain storage. */
const getToken = async (): Promise<string | null> => {
  const stored = await Keychain.getGenericPassword({ service: TOKEN_SERVICE });
  return stored ? stored.password : null;
};
export const hasToken = async () => (await getToken()) !== null;
export const clearToken = () =>
  Keychain.resetGenericPassword({ service: TOKEN_SERVICE });

export class RequestFailed extends Error {
  constructor(readonly error: ApiError) {
    super(error.message);
  }

  /** The request never reached the server: keep the work queued. */
  get offline(): boolean {
    return this.error.statusCode === 0;
  }

  get sessionEnded(): boolean {
    return (
      this.error.statusCode === 401 ||
      this.error.code === ERROR_CODES.ACCOUNT_LOCKED
    );
  }
}

const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const token = await getToken();
  let response: Response;
  try {
    response = await fetch(`${await getServer()}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init.body instanceof FormData
          ? {}
          : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new RequestFailed({
      statusCode: 0,
      code: ERROR_CODES.INTERNAL_ERROR,
      message: 'No connection.',
    });
  }
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new RequestFailed(
      body?.code
        ? (body as ApiError)
        : {
            statusCode: response.status,
            code: ERROR_CODES.INTERNAL_ERROR,
            message: 'Request failed.',
          },
    );
  }
  return body as T;
};

export const login = async (
  username: string,
  pin: string,
): Promise<MeResponse> => {
  const result = await request<LoginResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, pin, client: 'mobile' }),
  });
  await Keychain.setGenericPassword('session', result.token!, {
    service: TOKEN_SERVICE,
    accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
  return result.me;
};

export const me = () => request<MeResponse>('/auth/me');

export const changePin = (input: ChangePinInput) =>
  request<MeResponse>('/auth/change-pin', {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const logout = async () => {
  await request<void>('/auth/logout', { method: 'POST' }).catch(
    () => undefined,
  );
  await clearToken();
};

export const pull = () => request<PocPullResponse>('/poc/sync');

export const push = (mutations: PocMutation[]) =>
  request<PocPushResponse>('/poc/sync', {
    method: 'POST',
    body: JSON.stringify({ mutations }),
  });

export const uploadPhoto = (photo: {
  id: string;
  checkId: string;
  questionKey: string;
  uri: string;
  capturedAt: string;
}) => {
  const form = new FormData();
  form.append('id', photo.id);
  form.append('questionKey', photo.questionKey);
  form.append('capturedAt', photo.capturedAt);
  form.append('file', {
    uri: photo.uri,
    type: 'image/jpeg',
    name: `${photo.id}.jpg`,
  } as unknown as Blob);
  return request<PocEvidence>(`/poc/checks/${photo.checkId}/evidence`, {
    method: 'POST',
    body: form,
  });
};
