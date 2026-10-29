import {
  detectImageType,
  stripJpegMetadata,
  stripPngMetadata,
} from './image-sanitiser.js';

const jpegSegment = (marker: number, payload: string) => {
  const body = Buffer.from(payload, 'latin1');
  const length = Buffer.alloc(2);
  length.writeUInt16BE(body.length + 2);
  return Buffer.concat([Buffer.from([0xff, marker]), length, body]);
};

const pngChunk = (type: string, data: string) => {
  const body = Buffer.from(data, 'latin1');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  return Buffer.concat([
    length,
    Buffer.from(type, 'latin1'),
    body,
    Buffer.alloc(4),
  ]);
};

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

describe('image sanitiser (EVD-004, NFR-007)', () => {
  it('identifies images by their content, not their name', () => {
    expect(detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(
      'image/jpeg',
    );
    expect(
      detectImageType(Buffer.concat([PNG_SIGNATURE, Buffer.alloc(4)])),
    ).toBe('image/png');
    expect(detectImageType(Buffer.from('GIF89a'))).toBeNull();
    expect(detectImageType(Buffer.from('<svg></svg>'))).toBeNull();
  });

  it('removes EXIF, XMP, IPTC and comments from JPEGs, keeping the image', () => {
    const scan = Buffer.from([
      0xff, 0xda, 0x00, 0x04, 0x01, 0x02, 0xaa, 0xbb, 0xff, 0xd9,
    ]);
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      jpegSegment(0xe0, 'JFIF\0'),
      jpegSegment(0xe1, 'Exif\0\0GPSLatitude'),
      jpegSegment(0xed, 'Photoshop 3.0 IPTC'),
      jpegSegment(0xfe, 'taken at 53.8N'),
      jpegSegment(0xdb, 'quantisation'),
      scan,
    ]);
    const clean = stripJpegMetadata(jpeg).toString('latin1');
    expect(clean).not.toMatch(/GPSLatitude|IPTC|53\.8N/);
    expect(clean).toContain('JFIF');
    expect(clean).toContain('quantisation');
    expect(clean.endsWith(scan.toString('latin1'))).toBe(true);
  });

  it('removes EXIF and text chunks from PNGs', () => {
    const png = Buffer.concat([
      PNG_SIGNATURE,
      pngChunk('IHDR', 'header'),
      pngChunk('eXIf', 'GPS'),
      pngChunk('tEXt', 'Location\0Leeds'),
      pngChunk('IDAT', 'pixels'),
      pngChunk('IEND', ''),
    ]);
    const clean = stripPngMetadata(png).toString('latin1');
    expect(clean).not.toMatch(/eXIf|tEXt|Leeds/);
    expect(clean).toMatch(/IHDR[\s\S]*IDAT[\s\S]*IEND/);
  });

  it('rejects truncated files', () => {
    expect(() =>
      stripJpegMetadata(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x40])),
    ).toThrow();
    expect(() =>
      stripPngMetadata(Buffer.concat([PNG_SIGNATURE, pngChunk('IHDR', 'x')])),
    ).toThrow();
  });
});
