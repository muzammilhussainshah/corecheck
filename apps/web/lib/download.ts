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
 * Downloads a file the API generates (an export, a label sheet). Failures
 * are shown as a toast with the server's message, never as a broken page.
 */
export const downloadFile = async (
  path: string,
  fallbackName: string,
): Promise<boolean> => {
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
    return false;
  }
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as ApiError | null;
    notifyError(
      error ?? {
        statusCode: response.status,
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'The file could not be created. Try again.',
      },
    );
    return false;
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = filenameOf(response, fallbackName);
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return true;
};
