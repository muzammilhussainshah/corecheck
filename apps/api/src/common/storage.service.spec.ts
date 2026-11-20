import { HttpStatus } from '@nestjs/common';
import { ERROR_CODES } from '@corecheck/shared';
import type { AppConfig } from '../config/app-config.js';
import { AppException } from './errors.js';
import { StorageService } from './storage.service.js';

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

  it('reports a clear error when storage cannot be reached', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(put()).rejects.toMatchObject({
      code: ERROR_CODES.SERVICE_UNAVAILABLE,
    });
  });
});
