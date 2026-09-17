/** npm 包名约束：小写、无空格，仅可含 `-` `_` `.`，且不能以 `.` `_` 开头。 */
export function toPackageName(raw: string, fallback = "my-agent"): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+/, "")
    .replace(/-+/g, "-");
  return cleaned || fallback;
}
