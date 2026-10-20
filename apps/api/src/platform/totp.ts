import { generateSecret, generateURI, verify } from 'otplib';
import QRCode from 'qrcode';

const ISSUER = 'CoreCheck Admin';

/**
 * Time-based one-time codes (RFC 6238) for internal staff sign-in. Codes from
 * the previous and next 30-second step are accepted to absorb clock drift.
 */
export const newTotpSecret = (): string => generateSecret();

export const totpUri = (accountEmail: string, secret: string): string =>
  generateURI({ issuer: ISSUER, label: accountEmail, secret });

export const totpQrCode = (uri: string): Promise<string> =>
  QRCode.toDataURL(uri, { margin: 1, width: 240 });

export const verifyTotp = async (
  secret: string,
  code: string,
): Promise<boolean> => {
  const result = await verify({ secret, token: code, epochTolerance: 30 });
  return result.valid;
};
