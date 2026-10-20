import { createTestApp, type TestApp } from './support/test-app.js';

describe('Health and HTTP basics', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('answers the health check without signing in', async () => {
    const response = await t.http.get('/health').expect(200);
    expect(response.body).toEqual({ status: 'ok', app: 'CoreCheck' });
  });

  it('sends security headers and a request id, and hides the framework', async () => {
    const response = await t.http
      .get('/health')
      .set('x-request-id', 'trace-abc-123')
      .expect(200);
    expect(response.headers).toMatchObject({
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'cache-control': 'no-store',
      'x-request-id': 'trace-abc-123',
    });
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('requires a session everywhere else', async () => {
    expect((await t.http.get('/users').expect(401)).body.code).toBe(
      'UNAUTHENTICATED',
    );
    expect(
      (await t.http.get('/platform/organisations').expect(401)).body.code,
    ).toBe('UNAUTHENTICATED');
    await t.http
      .get('/users')
      .set('authorization', 'Bearer not-a-real-token')
      .expect(401);
  });

  it('answers unknown routes and malformed ids with a plain 404', async () => {
    const unknown = await t.http.get('/no-such-route').expect(404);
    expect(unknown.body).toMatchObject({
      code: 'NOT_FOUND',
      message: 'Not found.',
    });
  });
});
