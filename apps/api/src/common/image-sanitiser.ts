/**
 * Image checks for uploaded evidence. The type is decided by the file's
 * leading bytes rather than the name or declared content type (NFR-007), and
 * metadata blocks are removed so no GPS position or device details are kept
 * (EVD-004, MOB-009).
 */

export type ImageType = 'image/jpeg' | 'image/png';

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

export const detectImageType = (data: Buffer): ImageType | null => {
  if (
    data.length >= 3 &&
    data[0] === 0xff &&
    data[1] === 0xd8 &&
    data[2] === 0xff
  ) {
    return 'image/jpeg';
  }
  if (data.length >= 8 && data.subarray(0, 8).equals(PNG_SIGNATURE))
    return 'image/png';
  return null;
};

/** JPEG segments that may carry location or device data: APP1 (EXIF, XMP), APP13 (IPTC), COM. */
const JPEG_DROPPED_MARKERS = new Set([0xe1, 0xed, 0xfe]);

export const stripJpegMetadata = (data: Buffer): Buffer => {
  const parts: Buffer[] = [data.subarray(0, 2)];
  let offset = 2;
  while (offset + 4 <= data.length) {
    if (data[offset] !== 0xff) throw new Error('Malformed JPEG segment.');
    const marker = data[offset + 1]!;
    // Start of scan: the compressed image follows; keep everything from here.
    if (marker === 0xda) {
      parts.push(data.subarray(offset));
      return Buffer.concat(parts);
    }
    const length = data.readUInt16BE(offset + 2);
    const end = offset + 2 + length;
    if (length < 2 || end > data.length)
      throw new Error('Malformed JPEG segment.');
    if (!JPEG_DROPPED_MARKERS.has(marker))
      parts.push(data.subarray(offset, end));
    offset = end;
  }
  throw new Error('JPEG has no image data.');
};

/** PNG chunks that may carry location or free-text metadata. */
const PNG_DROPPED_CHUNKS = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);

export const stripPngMetadata = (data: Buffer): Buffer => {
  const parts: Buffer[] = [data.subarray(0, 8)];
  let offset = 8;
  while (offset + 12 <= data.length) {
    const length = data.readUInt32BE(offset);
    const type = data.toString('latin1', offset + 4, offset + 8);
    const end = offset + 12 + length;
    if (end > data.length) throw new Error('Malformed PNG chunk.');
    if (!PNG_DROPPED_CHUNKS.has(type)) parts.push(data.subarray(offset, end));
    offset = end;
    if (type === 'IEND') return Buffer.concat(parts);
  }
  throw new Error('PNG has no end chunk.');
};

export const stripImageMetadata = (data: Buffer, type: ImageType): Buffer =>
  type === 'image/jpeg' ? stripJpegMetadata(data) : stripPngMetadata(data);
