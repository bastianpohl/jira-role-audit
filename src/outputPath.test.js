import { describe, expect, test } from 'vitest';
import { resolveOutputPath, validateOutputPath, describeWriteError } from './outputPath.js';

describe('resolveOutputPath', () => {
  test('passes a normal path through', () => {
    expect(resolveOutputPath('jira-role-audit.html')).toBe('jira-role-audit.html');
  });

  test('strips the quotes cmd.exe leaves in the value', () => {
    expect(resolveOutputPath('"C:\\reports\\audit.html"')).toBe('C:\\reports\\audit.html');
    expect(resolveOutputPath("'out/audit.html'")).toBe('out/audit.html');
  });

  test('keeps quotes that are not a matching pair', () => {
    expect(resolveOutputPath('a"b.html')).toBe('a"b.html');
    expect(resolveOutputPath('"unbalanced.html')).toBe('"unbalanced.html');
  });

  test('trims surrounding whitespace, including inside quotes', () => {
    expect(resolveOutputPath('  audit.html  ')).toBe('audit.html');
    expect(resolveOutputPath('" audit.html "')).toBe('audit.html');
  });

  test('an unset value becomes the empty string so the caller can default', () => {
    expect(resolveOutputPath(undefined)).toBe('');
  });
});

describe('validateOutputPath', () => {
  test('accepts a plain name on every platform', () => {
    expect(validateOutputPath('jira-role-audit.html', 'win32')).toBeNull();
    expect(validateOutputPath('jira-role-audit.html', 'darwin')).toBeNull();
  });

  test('rejects an empty path regardless of platform', () => {
    expect(validateOutputPath('', 'darwin')).toMatch(/empty/i);
  });

  test('rejects Windows-illegal characters only on Windows', () => {
    expect(validateOutputPath('audit:2026.html', 'win32')).toMatch(/does not allow/i);
    expect(validateOutputPath('report|x.html', 'win32')).toMatch(/does not allow/i);
    expect(validateOutputPath('a?.html', 'win32')).toMatch(/does not allow/i);
    // Perfectly legal elsewhere, so it must not be rejected there.
    expect(validateOutputPath('audit:2026.html', 'darwin')).toBeNull();
  });

  test('does not mistake a drive letter colon for an illegal character', () => {
    expect(validateOutputPath('C:\\reports\\audit.html', 'win32')).toBeNull();
    expect(validateOutputPath('c:/reports/audit.html', 'win32')).toBeNull();
  });

  test('rejects reserved device names with or without an extension', () => {
    expect(validateOutputPath('NUL', 'win32')).toMatch(/reserved/i);
    expect(validateOutputPath('CON.html', 'win32')).toMatch(/reserved/i);
    expect(validateOutputPath('out\\LPT1.html', 'win32')).toMatch(/reserved/i);
    expect(validateOutputPath('com1.HTML', 'win32')).toMatch(/reserved/i);
  });

  test('does not flag names that merely start like a reserved one', () => {
    expect(validateOutputPath('console.html', 'win32')).toBeNull();
    expect(validateOutputPath('nullreport.html', 'win32')).toBeNull();
  });

  test('rejects a segment ending in a space or dot', () => {
    expect(validateOutputPath('report .html', 'win32')).toBeNull(); // space is mid-name, fine
    expect(validateOutputPath('report.', 'win32')).toMatch(/space or dot/i);
    expect(validateOutputPath('folder \\a.html', 'win32')).toMatch(/space or dot/i);
  });

  test('handles both separators', () => {
    expect(validateOutputPath('out/sub/audit.html', 'win32')).toBeNull();
    expect(validateOutputPath('out\\sub\\audit.html', 'win32')).toBeNull();
  });
});

describe('describeWriteError', () => {
  test('explains a locked file, the usual Windows cause', () => {
    const msg = describeWriteError(Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' }), 'a.html');
    expect(msg).toMatch(/open in another program/i);
    expect(msg).toMatch(/a\.html/);
  });

  test('explains EBUSY, ENOENT, ENAMETOOLONG and ENOSPC', () => {
    const of = (code) => describeWriteError(Object.assign(new Error(code), { code }), 'a.html');
    expect(of('EBUSY')).toMatch(/locked/i);
    expect(of('ENOENT')).toMatch(/folder does not exist/i);
    expect(of('ENAMETOOLONG')).toMatch(/260/);
    expect(of('ENOSPC')).toMatch(/disk is full/i);
  });

  test('falls back to the raw message for an unknown code', () => {
    const msg = describeWriteError(Object.assign(new Error('weird'), { code: 'EWAT' }), 'a.html');
    expect(msg).toBe('Could not write a.html: weird');
  });
});
