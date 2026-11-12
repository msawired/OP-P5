import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';

/** Signed requests older or newer than this are rejected. */
export const MIGRATION_SIGNATURE_MAX_SKEW_SECONDS = 300;

/**
 * HMAC-SHA256 (hex) over `METHOD\nPATH\nTIMESTAMP`, where PATH is the request
 * path including the query string exactly as sent. Must match the signer in
 * OpenProcessing's P5_controller::signedGet().
 */
export function signMigrationRequest(
  method: string,
  path: string,
  timestamp: string,
  secret: string
): string {
  return crypto
    .createHmac('sha256', secret)
    .update(`${method.toUpperCase()}\n${path}\n${timestamp}`)
    .digest('hex');
}

function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Guards the read-only migration endpoints that OpenProcessing calls
 * server-to-server. The endpoints answer 404 unless P5_MIGRATION_HMAC_SECRET
 * is set, so they stay invisible on deployments that don't take part.
 *
 * P5_MIGRATION_ALLOWED_IPS (optional, comma-separated) adds an IP allowlist.
 * It compares against req.ip, which honors X-Forwarded-For because the app
 * sets `trust proxy`; it only adds protection when the edge proxy overwrites
 * that header. The HMAC check is the real guard.
 */
export function verifyMigrationSignature(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const secret = process.env.P5_MIGRATION_HMAC_SECRET;
  if (!secret) {
    res.status(404).json({ error: 'Not found.' });
    return;
  }

  const allowedIps = (process.env.P5_MIGRATION_ALLOWED_IPS || '')
    .split(',')
    .map((ip) => ip.trim())
    .filter(Boolean);
  if (allowedIps.length > 0 && !allowedIps.includes(req.ip || '')) {
    res.status(403).json({ error: 'Forbidden.' });
    return;
  }

  const timestamp = req.get('X-P5-Timestamp') || '';
  const signature = (req.get('X-P5-Signature') || '').toLowerCase();
  const ts = Number(timestamp);
  if (
    !/^\d+$/.test(timestamp) ||
    Math.abs(Date.now() / 1000 - ts) > MIGRATION_SIGNATURE_MAX_SKEW_SECONDS
  ) {
    res.status(401).json({ error: 'Missing or expired signature.' });
    return;
  }

  const expected = signMigrationRequest(
    req.method,
    req.originalUrl,
    timestamp,
    secret
  );
  if (!signature || !safeEqualHex(signature, expected)) {
    res.status(401).json({ error: 'Invalid signature.' });
    return;
  }

  // Manifests carry password hashes: never let a proxy or browser cache them.
  res.set('Cache-Control', 'no-store');
  next();
}
