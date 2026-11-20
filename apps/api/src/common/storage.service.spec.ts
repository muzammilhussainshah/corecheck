import { HttpStatus } from '@nestjs/common';
import { ERROR_CODES } from '@corecheck/shared';
import type { AppConfig } from '../config/app-config.js';
import { AppException } from './errors.js';
import {
  describeSupabaseKey,
  normaliseSupabaseKey,
  StorageService,
} from './storage.service.js';

const supabaseConfig = {
  STORAGE_DRIVER: 'supabase',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'k'.repeat(40),
  SUPABASE_STORAGE_BUCKET: 'corecheck-files',
} as AppConfig;

const reply = (status: number, body = '') =>
  new Response(body, { status, headers: { 'content-type': 'text/plain' } });

describe('StorageService (Supabase)', () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const put = () =>
    new StorageService(supabaseConfig).put(
      'org/plants/p/documents/d/v.png',
      Buffer.from('png'),
      'image/png',
    );

  it('creates the bucket on first use, then uploads the file', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(200, '{"name":"corecheck-files"}'))
      .mockResolvedValueOnce(reply(200, '{"Key":"x"}'));
    await put();
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      'https://example.supabase.co/storage/v1/bucket',
      'https://example.supabase.co/storage/v1/object/corecheck-files/org/plants/p/documents/d/v.png',
    ]);
  });

  it('keeps a bucket that already exists', async () => {
    fetchMock
      .mockResolvedValueOnce(
        reply(
          400,
          '{"error":"Duplicate","message":"The resource already exists"}',
        ),
      )
      .mockResolvedValueOnce(reply(200));
    await expect(put()).resolves.toBeUndefined();
  });

  // The upload must fail with a reason the user can see, not silently or as
  // a generic server error (Milestone 2 bug 1).
  it.each([
    ['the bucket cannot be created', [reply(403, 'Invalid Compact JWS')]],
    [
      'the upload is refused',
      [reply(200), reply(400, 'mime type image/png is not supported')],
    ],
  ])('reports a clear "not saved" error when %s', async (_case, replies) => {
    for (const response of replies) fetchMock.mockResolvedValueOnce(response);
    const error = await put().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AppException);
    expect(error).toMatchObject({
      code: ERROR_CODES.SERVICE_UNAVAILABLE,
      message: expect.stringMatching(/could not be saved/),
    });
    expect((error as AppException).getStatus()).toBe(
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  });

  // Milestone 2 bug 1: staging's sb_secret_ key was sent as a Bearer token
  // and Storage answered 403 "JWS Protected Header is invalid".
  describe('authorisation headers', () => {
    const headersFor = async (key: string) => {
      fetchMock.mockResolvedValue(reply(200));
      await new StorageService({
        ...supabaseConfig,
        SUPABASE_SERVICE_ROLE_KEY: key,
      } as AppConfig).put('org/a.png', Buffer.from('png'), 'image/png');
      return fetchMock.mock.calls.map(
        ([, init]) => init!.headers as Record<string, string>,
      );
    };

    it('sends a secret key (sb_secret_...) as apikey only, never as a Bearer token', async () => {
      const key = `sb_secret_${'x'.repeat(32)}`;
      for (const headers of await headersFor(key)) {
        expect(headers.apikey).toBe(key);
        expect(headers).not.toHaveProperty('authorization');
      }
    });

    it('sends a legacy service_role JWT in both headers', async () => {
      const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2ln';
      for (const headers of await headersFor(jwt)) {
        expect(headers.apikey).toBe(jwt);
        expect(headers.authorization).toBe(`Bearer ${jwt}`);
      }
    });

    // Staging still got "JWS Protected Header is invalid" with the first fix:
    // a key pasted with quotes or "Bearer " looks like a JWT but is not one.
    it.each([
      ['quotes', (k: string) => `"${k}"`],
      ['single quotes', (k: string) => `'${k}'`],
      ['a Bearer prefix', (k: string) => `Bearer ${k}`],
      ['quotes and spaces', (k: string) => ` "Bearer ${k}"\n`],
    ])('cleans a legacy JWT pasted with %s', async (_case, paste) => {
      const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2ln';
      for (const headers of await headersFor(paste(jwt))) {
        expect(headers.apikey).toBe(jwt);
        expect(headers.authorization).toBe(`Bearer ${jwt}`);
      }
    });

    it('never sends a value that only looks like a JWT as a Bearer token', async () => {
      for (const headers of await headersFor('abc.def.ghi-not-a-jwt-at-all'))
        expect(headers).not.toHaveProperty('authorization');
    });

    it('ignores stray whitespace around the key', async () => {
      const key = `sb_secret_${'y'.repeat(32)}`;
      for (const headers of await headersFor(`  ${key}\n`))
        expect(headers.apikey).toBe(key);
    });
  });

  it('names the kind of key for the logs, never the key', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2ln';
    expect(describeSupabaseKey(`sb_secret_${'z'.repeat(32)}`)).toBe(
      'secret key (sb_secret_)',
    );
    expect(describeSupabaseKey(jwt)).toBe('legacy service_role JWT');
    expect(describeSupabaseKey(`"${jwt}"`)).toBe('unrecognised');
    expect(describeSupabaseKey(normaliseSupabaseKey(`"${jwt}"`))).toBe(
      'legacy service_role JWT',
    );
    expect(describeSupabaseKey('sb_publishable_abc')).toBe('unrecognised');
  });

  it('reports a clear error when storage cannot be reached', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(put()).rejects.toMatchObject({
      code: ERROR_CODES.SERVICE_UNAVAILABLE,
    });
  });
});
