import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { User } from '../models/user';
import Project from '../models/project';
import Collection from '../models/collection';

/**
 * Read-only endpoints that OpenProcessing pulls during the p5 -> OP migration
 * (see OP's P5_controller and the "P5 Backend Migration Pipeline" doc). OP
 * drives every migration; this side only answers signed requests and never
 * writes. Mounted behind verifyMigrationSignature.
 */

export const USERS_PAGE_DEFAULT = 1000;
export const USERS_PAGE_MAX = 5000;

interface MongoFile {
  _id: unknown;
  name?: string;
  content?: string;
  url?: string;
  children?: string[];
  fileType?: string;
  isSelectedFile?: boolean;
}

export interface ManifestCode {
  path: string;
  content: string;
}

export interface ManifestAsset {
  path: string;
  url: string;
  bucket?: string;
  key?: string;
}

/** A path segment OP can safely use as part of an S3 key. */
function isSafeSegment(name: unknown): name is string {
  return (
    typeof name === 'string' &&
    name !== '' &&
    name !== '.' &&
    name !== '..' &&
    !name.includes('/') &&
    !name.includes('\\')
  );
}

/**
 * Flattens a project's `files` (a flat list whose `root` folder links children
 * by id) into real paths, in tree order. Folders, including empty ones, are
 * dropped. Files with `content` and no `url` are code; files with a `url`
 * (binaries, plus text files the uploader sent to S3) are assets. Files not
 * reachable from `root`, and names that aren't safe path segments, are skipped.
 */
export function flattenProjectFiles(files: MongoFile[] = []) {
  const byId = new Map<string, MongoFile>();
  files.forEach((f) => byId.set(String(f._id), f));
  const root = files.find((f) => f.name === 'root');

  const code: ManifestCode[] = [];
  const assets: { path: string; url: string }[] = [];
  let selectedPath: string | null = null;
  const visited = new Set<string>();

  const walk = (folder: MongoFile, prefix: string) => {
    (folder.children || []).forEach((childId) => {
      const id = String(childId);
      const child = byId.get(id);
      if (!child || visited.has(id) || !isSafeSegment(child.name)) return;
      visited.add(id);
      const path = prefix ? `${prefix}/${child.name}` : child.name;
      if (child.fileType === 'folder') {
        walk(child, path);
        return;
      }
      if (child.url) {
        assets.push({ path, url: child.url });
      } else {
        code.push({ path, content: child.content || '' });
      }
      if (child.isSelectedFile) selectedPath = path;
    });
  };

  if (root) {
    visited.add(String(root._id));
    walk(root, '');
  }
  // `as`: TS narrows the closure-assigned variable back to its initial null.
  return { code, assets, selectedPath: selectedPath as string | null };
}

/** URL prefixes that serve the p5 bucket at its root, from the editor's env. */
function bucketUrlBases(): string[] {
  const bases: string[] = [];
  if (process.env.S3_BUCKET_URL_BASE)
    bases.push(process.env.S3_BUCKET_URL_BASE);
  if (process.env.AWS_REGION && process.env.S3_BUCKET) {
    bases.push(
      `https://s3-${process.env.AWS_REGION}.amazonaws.com/${process.env.S3_BUCKET}/`
    );
  }
  return bases.map((b) => (b.endsWith('/') ? b : `${b}/`));
}

/**
 * Resolves an asset URL to `{ bucket, key }` when it points at the p5 bucket,
 * so OP can CopyObject it without guessing. Recognizes the editor's own URL
 * bases plus virtual-hosted and path-style S3 URLs. Returns null for anything
 * else (external URLs), which OP skips without fetching.
 */
export function resolveAssetSource(
  url: string
): { bucket: string; key: string } | null {
  const bucket = process.env.S3_BUCKET;
  if (!bucket || !url) return null;
  const clean = url.split('?')[0].split('#')[0];

  const decode = (k: string) => {
    try {
      return decodeURIComponent(k);
    } catch {
      return k;
    }
  };

  const base = bucketUrlBases().find((b) => clean.startsWith(b));
  if (base) {
    const key = clean.slice(base.length);
    return key ? { bucket, key: decode(key) } : null;
  }

  let parsed: URL;
  try {
    parsed = new URL(clean);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return null;
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.replace(/^\//, '');
  const escaped = bucket.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  let key: string | null = null;
  if (
    new RegExp(`^${escaped}\\.s3([.-][a-z0-9-]+)*\\.amazonaws\\.com$`).test(
      host
    )
  ) {
    key = path; // virtual-hosted style
  } else if (
    /^s3([.-][a-z0-9-]+)*\.amazonaws\.com$/.test(host) &&
    path.startsWith(`${bucket}/`)
  ) {
    key = path.slice(bucket.length + 1); // path style
  }
  return key ? { bucket, key: decode(key) } : null;
}

function toAsset(asset: { path: string; url: string }): ManifestAsset {
  const source = resolveAssetSource(asset.url);
  return source ? { ...asset, ...source } : asset;
}

/**
 * GET /migration/manifest/:username
 * Everything OP needs to import one user: account fields (an explicit list;
 * OAuth tokens, API keys and reset/verify tokens are never included),
 * projects with flattened code and assets, and collections whose items still
 * point at existing projects. Username match is exact, as on p5.
 */
export async function getMigrationManifest(req: Request, res: Response) {
  try {
    const user = await User.findByUsername(req.params.username);
    if (!user) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    const projects = await Project.find({ user: user._id })
      .sort('createdAt')
      .lean()
      .exec();

    const collections = await Collection.find({ owner: user._id })
      .sort('createdAt')
      .lean()
      .exec();

    // Collection items may point at anyone's projects; keep only those that
    // still exist (the `isDeleted` case in models/collection.js).
    const itemProjectIds = [
      ...new Set(
        collections.flatMap((c: any) =>
          (c.items || []).map((i: any) => String(i.project))
        )
      )
    ];
    const existing = new Set(
      (
        await Project.find({ _id: { $in: itemProjectIds } }, '_id')
          .lean()
          .exec()
      ).map((p: any) => String(p._id))
    );

    const manifest = {
      p5UserID: user._id.toHexString(),
      username: user.username,
      name: user.name || '',
      email: user.email || null,
      emailVerified: user.verified === User.EmailConfirmation().Verified,
      passwordHash: user.password || null,
      github: user.github || null,
      google: user.google || null,
      banned: !!user.banned,
      preferences: user.preferences || null,
      createdAt: user.createdAt || null,
      lastLoginAt: user.lastLoginTimestamp || null,
      projects: projects.map((p: any) => {
        const { code, assets, selectedPath } = flattenProjectFiles(p.files);
        return {
          p5ProjectID: String(p._id),
          name: p.name,
          visibility: p.visibility || 'Public',
          createdAt: p.createdAt || null,
          updatedAt: p.updatedAt || null,
          selectedPath,
          code,
          assets: assets.map(toAsset)
        };
      }),
      collections: collections.map((c: any) => ({
        p5CollectionID: String(c._id),
        name: c.name,
        description: c.description || '',
        createdAt: c.createdAt || null,
        updatedAt: c.updatedAt || null,
        items: (c.items || [])
          .filter((i: any) => existing.has(String(i.project)))
          .map((i: any) => ({
            p5ProjectID: String(i.project),
            addedAt: i.createdAt || null
          }))
      }))
    };

    console.info(
      `[migration] manifest served: ${user.username} (${manifest.projects.length} projects) to ${req.ip}`
    );
    res.json(manifest);
  } catch (err) {
    console.error('[migration] manifest failed:', err);
    res.status(500).json({ error: 'Could not build manifest.' });
  }
}

const MIGRATION_STATES = ['migrating', 'migrated', 'none'] as const;

/**
 * POST /migration/status?(p5UserID=<id>|username=<name>)&state=<state>[&opUserID=&opUsername=]
 * The one write OP makes on this side. All parameters are in the query string,
 * so the request signature covers them (there is no body).
 *   migrating: freeze the account before OP takes its snapshot
 *   migrated:  the import finished; record the OP account
 *   none:      clear the flag (failed or purged import)
 */
export async function setMigrationStatus(req: Request, res: Response) {
  const q = (name: string) =>
    typeof req.query[name] === 'string' ? (req.query[name] as string) : '';
  const p5UserID = q('p5UserID');
  const username = q('username');
  const state = q('state') as typeof MIGRATION_STATES[number];

  if (!MIGRATION_STATES.includes(state)) {
    res
      .status(400)
      .json({ error: 'state must be migrating, migrated or none.' });
    return;
  }
  if (!!p5UserID === !!username) {
    res
      .status(400)
      .json({ error: 'Pass exactly one of p5UserID or username.' });
    return;
  }
  if (p5UserID && !mongoose.Types.ObjectId.isValid(p5UserID)) {
    res.status(400).json({ error: 'Invalid p5UserID.' });
    return;
  }

  try {
    const filter = p5UserID ? { _id: p5UserID } : { username };
    const opUserID = Number(q('opUserID'));
    const update =
      state === 'none'
        ? { $unset: { migration: 1 } }
        : {
            $set: {
              migration: {
                state,
                ...(Number.isInteger(opUserID) && opUserID > 0
                  ? { opUserID }
                  : {}),
                ...(q('opUsername') ? { opUsername: q('opUsername') } : {}),
                updatedAt: new Date()
              }
            }
          };
    const user = await User.findOneAndUpdate(filter, update, {
      new: true
    }).exec();
    if (!user) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }
    console.info(
      `[migration] status ${state}: ${user.username} (${user._id}) by ${req.ip}`
    );
    res.json({
      p5UserID: user._id.toHexString(),
      username: user.username,
      migration: user.migration?.state ? user.migration : null
    });
  } catch (err) {
    console.error('[migration] status update failed:', err);
    res.status(500).json({ error: 'Could not update migration status.' });
  }
}

/**
 * GET /migration/users?after=<p5UserID>&limit=<n>
 * Keyset-paginated list of every user, sorted by _id, for OP's bulk queueing
 * and delta passes. Returns [] when there are no more users.
 */
export async function listMigrationUsers(req: Request, res: Response) {
  const after = typeof req.query.after === 'string' ? req.query.after : '';
  const rawLimit = Number(req.query.limit);
  const limit =
    Number.isInteger(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, USERS_PAGE_MAX)
      : USERS_PAGE_DEFAULT;

  if (after && !mongoose.Types.ObjectId.isValid(after)) {
    res.status(400).json({ error: 'Invalid `after` cursor.' });
    return;
  }

  try {
    const query = after
      ? { _id: { $gt: new mongoose.Types.ObjectId(after) } }
      : {};
    const users = await User.find(query, 'username updatedAt')
      .sort({ _id: 1 })
      .limit(limit)
      .lean()
      .exec();
    res.json(
      users.map((u: any) => ({
        p5UserID: String(u._id),
        username: u.username,
        updatedAt: u.updatedAt || null
      }))
    );
  } catch (err) {
    console.error('[migration] user list failed:', err);
    res.status(500).json({ error: 'Could not list users.' });
  }
}
