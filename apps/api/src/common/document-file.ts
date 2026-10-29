import { MAX_DOCUMENT_BYTES } from '@corecheck/shared';
import { fieldError } from './errors.js';
import { detectImageType, stripImageMetadata } from './image-sanitiser.js';

export interface CheckedFile {
  body: Buffer;
  contentType: 'application/pdf' | 'image/jpeg' | 'image/png';
  extension: 'pdf' | 'jpg' | 'png';
  fileName: string;
}

const PDF_SIGNATURE = Buffer.from('%PDF-');

/** A name safe to show and to offer as a download name. */
const cleanName = (name: string | undefined, extension: string): string => {
  const base = (name ?? '')
    .replace(/^.*[\\/]/, '')
    .replace(/[^\w.\- ()]+/g, '_')
    .trim()
    .slice(0, 120);
  return base || `document.${extension}`;
};

/**
 * Checks an uploaded document before it is kept (NFR-007): PDF, JPEG or PNG
 * only, decided by the file's own bytes rather than its name, at most
 * MAX_DOCUMENT_BYTES. Photos lose their metadata, so no location or device
 * details are stored (FRD 26: no GPS capture).
 */
export const checkDocumentFile = (
  file: { buffer: Buffer; size: number; originalname?: string } | undefined,
): CheckedFile => {
  if (!file || file.size === 0)
    throw fieldError('file', 'Choose a file to upload.');
  if (file.size > MAX_DOCUMENT_BYTES)
    throw fieldError('file', 'The file is larger than 20 MB.');

  if (file.buffer.subarray(0, PDF_SIGNATURE.length).equals(PDF_SIGNATURE)) {
    return {
      body: file.buffer,
      contentType: 'application/pdf',
      extension: 'pdf',
      fileName: cleanName(file.originalname, 'pdf'),
    };
  }
  const image = detectImageType(file.buffer);
  if (!image) throw fieldError('file', 'Upload a PDF, JPEG or PNG file.');
  let body: Buffer;
  try {
    body = stripImageMetadata(file.buffer, image);
  } catch {
    throw fieldError('file', 'The image could not be read. Try another file.');
  }
  const extension = image === 'image/jpeg' ? 'jpg' : 'png';
  return {
    body,
    contentType: image,
    extension,
    fileName: cleanName(file.originalname, extension),
  };
};
