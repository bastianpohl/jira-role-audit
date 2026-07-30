/**
 * Output path handling. Split out from main.js so the Windows rules are testable
 * on any platform — they are exactly the rules that cannot be exercised by
 * running the tool on macOS or Linux.
 */

/** Device names Windows reserves, with or without an extension. */
const WINDOWS_RESERVED = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

/**
 * Clean up a raw OUTPUT_FILE value.
 *
 * `set OUTPUT_FILE="C:\reports\audit.html"` in cmd.exe keeps the quotes as part
 * of the value, and `"` is an illegal filename character on Windows — so the
 * write fails with a cryptic errno on a command that looks perfectly correct.
 * @param {string|undefined} raw
 * @returns {string}
 */
export function resolveOutputPath(raw) {
  const trimmed = String(raw ?? '').trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1).trim();
    }
  }
  return trimmed;
}

/**
 * Check a path against the target platform's filename rules.
 * Only enforced for win32: a name like `audit:2026.html` is perfectly legal on
 * macOS and Linux, so rejecting it there would be wrong.
 * @param {string} outPath
 * @param {string} [platform] defaults to the current process platform
 * @returns {string|null} a human-readable reason, or null when the path is fine
 */
export function validateOutputPath(outPath, platform = process.platform) {
  if (!outPath) return 'OUTPUT_FILE is empty.';
  if (platform !== 'win32') return null;

  // Strip a drive prefix so its colon is not mistaken for an illegal character.
  const withoutDrive = /^[a-zA-Z]:[\\/]/.test(outPath) ? outPath.slice(2) : outPath;

  const illegal = withoutDrive.match(/[<>:"|?*]/);
  if (illegal) {
    return `Windows does not allow "${illegal[0]}" in a file path (OUTPUT_FILE=${outPath}).`;
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(outPath)) {
    return `OUTPUT_FILE contains a control character (OUTPUT_FILE=${outPath}).`;
  }

  const segments = withoutDrive.split(/[\\/]/).filter(Boolean);
  for (const segment of segments) {
    if (/[ .]$/.test(segment)) {
      return `Windows cannot create "${segment}": a name may not end in a space or dot.`;
    }
    const stem = segment.split('.')[0].toUpperCase();
    if (WINDOWS_RESERVED.has(stem)) {
      return `"${segment}" is a reserved device name on Windows — pick another file name.`;
    }
  }

  return null;
}

/**
 * Turn a write failure into something a user can act on. The raw errno codes
 * are especially opaque on Windows, where a locked file is the usual cause.
 * @param {NodeJS.ErrnoException} err
 * @param {string} outPath
 * @returns {string}
 */
export function describeWriteError(err, outPath) {
  const base = `Could not write ${outPath}: ${err.message}`;
  switch (err.code) {
    case 'EPERM':
    case 'EACCES':
      return `${base}\nThe file may be open in another program, or the folder may be read-only. ` +
        'On Windows an open browser tab, OneDrive sync or antivirus can hold the file — close it and retry.';
    case 'EBUSY':
      return `${base}\nThe file is locked by another process (often a browser still showing the report).`;
    case 'ENOENT':
      return `${base}\nThe target folder does not exist and could not be created.`;
    case 'ENAMETOOLONG':
      return `${base}\nThe path is too long. Windows limits paths to 260 characters unless long paths are enabled.`;
    case 'ENOSPC':
      return `${base}\nThe disk is full.`;
    default:
      return base;
  }
}
