/** An unset or invalid URL hides the optional sidebar event entrance. */
export function eventUrlOrNull(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password
      ? raw
      : null;
  } catch {
    return null;
  }
}
