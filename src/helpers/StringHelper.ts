export function isBlank(value?: string | null): boolean {
  return value === null || value === undefined || String(value).trim() === '';
}
