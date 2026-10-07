/**
 * A missing file is not the same as a file that could not be read. Callers that
 * start a fresh library on every read failure will overwrite a parts list, a
 * templates list, or a content index the moment the next save succeeds.
 */
export function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}
