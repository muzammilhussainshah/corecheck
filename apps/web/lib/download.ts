import { type ApiError, ERROR_CODES } from '@corecheck/shared';
import { notifyError } from '@corecheck/ui';

/** The file name the API suggested in X-Filename, or a fallback. */
const filenameOf = (response: Response, fallback: string): string => {
  const name = response.headers.get('x-filename');
  try {
    return name ? decodeURIComponent(name) : fallback;
  } catch {
    return fallback;
  }
};

/**
 * Fetches a file from the API. Failures are shown as a toast with the
 * server's message, never as a broken page.
 */
const fetchFile = async (
  path: string,
): Promise<{ blob: Blob; response: Response } | null> => {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, { credentials: 'same-origin' });
  } catch {
    notifyError({
      statusCode: 0,
      code: ERROR_CODES.SERVICE_UNAVAILABLE,
      message:
        'Could not reach CoreCheck. Check your connection and try again.',
    });
    return null;
  }
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as ApiError | null;
    notifyError(
      error ?? {
        statusCode: response.status,
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'The file could not be opened. Try again.',
      },
    );
    return null;
  }
  return { blob: await response.blob(), response };
};

/** Saves a file the API generates (an export, a label sheet, a document). */
export const downloadFile = async (
  path: string,
  fallbackName: string,
): Promise<boolean> => {
  const file = await fetchFile(path);
  if (!file) return false;
  const url = URL.createObjectURL(file.blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filenameOf(file.response, fallbackName);
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return true;
};

/**
 * Opens a document (PDF or photo) in a new tab to read. The tab is opened
 * straight away, while the click still counts as the user's, so popup
 * blockers allow it; the file is put in it once fetched.
 */
export const openFile = async (path: string): Promise<void> => {
  const tab = window.open('', '_blank');
  const file = await fetchFile(path);
  if (!file) {
    tab?.close();
    return;
  }
  const url = URL.createObjectURL(file.blob);
  if (tab) tab.location.href = url;
  else window.location.href = url;
  // Long enough for the tab to load it.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
};
