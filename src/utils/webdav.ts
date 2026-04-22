/**
 * Minimal WebDAV client using @tauri-apps/plugin-http so requests go through
 * Rust's HTTP stack — bypassing browser CORS restrictions entirely.
 *
 * Supports: GET, PUT, MKCOL, PROPFIND (existence check), DELETE
 */

import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

export interface WebDAVOptions {
  serverUrl: string;
  username:  string;
  password:  string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function basicAuth(username: string, password: string): string {
  const creds = new TextEncoder().encode(`${username}:${password}`)
  let binary = ''
  for (const byte of creds) binary += String.fromCharCode(byte)
  return 'Basic ' + btoa(binary)
}

function buildUrl(opts: WebDAVOptions, path: string): string {
  const base = opts.serverUrl.replace(/\/+$/, '');
  const rel  = path.replace(/^\/+/, '');
  return `${base}/${rel}`;
}

// ─── API ─────────────────────────────────────────────────────────────────────

/** Download a file. Returns `{ ok: false }` on 404. */
export async function webdavGet(
  opts: WebDAVOptions,
  path: string,
): Promise<{ ok: boolean; status: number; body: string }> {
  const resp = await tauriFetch(buildUrl(opts, path), {
    method:  'GET',
    headers: { Authorization: basicAuth(opts.username, opts.password) },
  });
  return {
    ok:     resp.ok,
    status: resp.status,
    body:   resp.ok ? await resp.text() : '',
  };
}

/** Upload (create / replace) a file. */
export async function webdavPut(
  opts: WebDAVOptions,
  path: string,
  body: string,
): Promise<{ ok: boolean; status: number }> {
  const resp = await tauriFetch(buildUrl(opts, path), {
    method:  'PUT',
    headers: {
      Authorization:  basicAuth(opts.username, opts.password),
      'Content-Type': 'application/octet-stream',
    },
    body,
  });
  return { ok: resp.ok, status: resp.status };
}

/**
 * Create a remote collection (directory).
 * Returns true on success or if collection already exists (405).
 */
export async function webdavMkcol(opts: WebDAVOptions, path: string): Promise<boolean> {
  try {
    const resp = await tauriFetch(buildUrl(opts, path), {
      method:  'MKCOL',
      headers: { Authorization: basicAuth(opts.username, opts.password) },
    });
    return resp.ok || resp.status === 405;
  } catch {
    return false;
  }
}

/** Check whether a resource exists via PROPFIND depth-0. */
export async function webdavExists(opts: WebDAVOptions, path: string): Promise<boolean> {
  try {
    const resp = await tauriFetch(buildUrl(opts, path), {
      method:  'PROPFIND',
      headers: {
        Authorization: basicAuth(opts.username, opts.password),
        Depth:         '0',
      },
    });
    return resp.status !== 404;
  } catch {
    return false;
  }
}

/** Delete a remote resource. */
export async function webdavDelete(
  opts: WebDAVOptions,
  path: string,
): Promise<boolean> {
  try {
    const resp = await tauriFetch(buildUrl(opts, path), {
      method:  'DELETE',
      headers: { Authorization: basicAuth(opts.username, opts.password) },
    });
    return resp.ok || resp.status === 404;
  } catch {
    return false;
  }
}

/**
 * Quick connectivity + auth check via PROPFIND on root path.
 * Returns `{ ok, message }`.
 */
export async function webdavPing(
  opts: WebDAVOptions,
): Promise<{ ok: boolean; message: string }> {
  try {
    const resp = await tauriFetch(buildUrl(opts, '/'), {
      method:  'PROPFIND',
      headers: {
        Authorization: basicAuth(opts.username, opts.password),
        Depth:         '0',
      },
    });
    if (resp.status === 207 || resp.ok) return { ok: true,  message: `HTTP ${resp.status}` };
    if (resp.status === 401)            return { ok: false, message: '认证失败 (401)' };
    if (resp.status === 403)            return { ok: false, message: '访问被拒绝 (403)' };
    return { ok: false, message: `HTTP ${resp.status}` };
  } catch (e: unknown) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
