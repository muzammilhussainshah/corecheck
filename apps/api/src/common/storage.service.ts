import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { type AppConfig, InjectConfig } from '../config/app-config.js';
import { storageUnavailable } from './errors.js';

/** Object keys are built by the API from ids: letters, digits, - _ . and /. */
const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9/_.-]*$/;

/**
 * The Supabase server key as pasted into the environment, without what is
 * easily pasted with it: whitespace, surrounding quotes, a "Bearer " prefix.
 */
export const normaliseSupabaseKey = (raw: string): string =>
  raw
    .trim()
    .replace(/^(['"])([\s\S]*)\1$/, '$2')
    .trim()
    .replace(/^bearer\s+/i, '')
    .trim();

/** A JWT whose header decodes, i.e. a legacy service_role key. */
const isJwt = (key: string): boolean => {
  const parts = key.split('.');
  // Node's base64url decoder skips characters it does not know (a quote, a
  // space), so check them first.
  if (parts.length !== 3 || !parts.every((part) => /^[\w-]+$/.test(part)))
    return false;
  try {
    const header = JSON.parse(
      Buffer.from(parts[0]!, 'base64url').toString('utf8'),
    ) as { alg?: unknown };
    return typeof header.alg === 'string';
  } catch {
    return false;
  }
};

/**
 * What kind of key it is, for the logs; never the key itself.
 * "unrecognised" means it is neither a secret key nor a readable JWT.
 */
export const describeSupabaseKey = (
  key: string,
): 'secret key (sb_secret_)' | 'legacy service_role JWT' | 'unrecognised' =>
  key.startsWith('sb_secret_')
    ? 'secret key (sb_secret_)'
    : isJwt(key)
      ? 'legacy service_role JWT'
      : 'unrecognised';

/**
 * Keeps uploaded files (FRD 26 "File/object storage"). Files are only ever
 * read back through the API, which checks organisation and record scope
 * first (DOC-AC-03); nothing is publicly reachable.
 *
 * - local: under STORAGE_DIR, for development and tests.
 * - supabase: a private Supabase Storage bucket, reached with the service
 *   key from the server only.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private bucketReady: Promise<void> | null = null;

  constructor(@InjectConfig() private readonly config: AppConfig) {
    // Says at start-up which kind of key is in use (never the key), so a
    // badly pasted one shows in the logs before anyone uploads.
    if (config.STORAGE_DRIVER === 'supabase') {
      const kind = describeSupabaseKey(this.supabaseKey);
      const message = `Supabase Storage key: ${kind}.`;
      if (kind === 'unrecognised')
        this.logger.warn(
          `${message} Use the secret key (sb_secret_...) or the legacy service_role key (eyJ...).`,
        );
      else this.logger.log(message);
    }
  }

  /**
   * Stores a file. A storage failure is logged with the provider's reply and
   * reaches the user as a clear "not saved" error rather than a generic one,
   * so an upload never fails without saying why.
   */
  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    this.checkKey(key);
    try {
      await this.write(key, body, contentType);
    } catch (error) {
      const driver =
        this.config.STORAGE_DRIVER === 'supabase'
          ? `supabase, ${describeSupabaseKey(this.supabaseKey)}`
          : this.config.STORAGE_DRIVER;
      this.logger.error(
        `Could not store ${key} (${driver}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw storageUnavailable();
    }
  }

  private async write(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<void> {
    if (this.config.STORAGE_DRIVER === 'local') {
      const path = this.localPath(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, body, { flag: 'wx' });
      return;
    }
    await this.ensureBucket();
    const response = await this.supabase(`object/${this.bucket}/${key}`, {
      method: 'POST',
      headers: { 'content-type': contentType, 'x-upsert': 'false' },
      body: new Uint8Array(body),
    });
    if (!response.ok)
      throw new Error(
        `Storage upload failed (${response.status}): ${await response.text()}`,
      );
  }

  async get(key: string): Promise<Buffer> {
    this.checkKey(key);
    if (this.config.STORAGE_DRIVER === 'local')
      return readFile(this.localPath(key));
    const response = await this.supabase(`object/${this.bucket}/${key}`, {
      method: 'GET',
    });
    if (!response.ok)
      throw new Error(`Storage download failed (${response.status}).`);
    return Buffer.from(await response.arrayBuffer());
  }

  private get bucket(): string {
    return this.config.SUPABASE_STORAGE_BUCKET;
  }

  private checkKey(key: string): void {
    if (!SAFE_KEY.test(key) || key.includes('..'))
      throw new Error(`Unsafe storage key: ${key}`);
  }

  private localPath(key: string): string {
    const root = resolve(this.config.STORAGE_DIR);
    const path = resolve(root, key);
    if (!path.startsWith(root + sep)) throw new Error('Path outside storage.');
    return path;
  }

  /**
   * Supabase has two kinds of server key. A legacy service_role key is a JWT
   * and goes in both headers. A secret key (sb_secret_...) is not a JWT:
   * Storage refuses it as a Bearer token ("JWS Protected Header is
   * invalid"), so it goes in the apikey header only and the gateway
   * authorises the request from it.
   */
  private get supabaseKey(): string {
    return normaliseSupabaseKey(this.config.SUPABASE_SERVICE_ROLE_KEY ?? '');
  }

  private supabase(path: string, init: RequestInit): Promise<Response> {
    const key = this.supabaseKey;
    return fetch(`${this.config.SUPABASE_URL}/storage/v1/${path}`, {
      ...init,
      headers: {
        ...init.headers,
        apikey: key,
        ...(isJwt(key) && { authorization: `Bearer ${key}` }),
      },
    });
  }

  /** Creates the private bucket on first use; an existing one is kept. */
  private ensureBucket(): Promise<void> {
    this.bucketReady ??= (async () => {
      const response = await this.supabase('bucket', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: this.bucket,
          name: this.bucket,
          public: false,
        }),
      });
      if (response.ok) {
        this.logger.log(`Created private storage bucket ${this.bucket}.`);
        return;
      }
      const text = await response.text();
      if (!/already exists|duplicate/i.test(text)) {
        this.bucketReady = null;
        throw new Error(`Storage bucket check failed: ${text}`);
      }
    })();
    return this.bucketReady;
  }
}
