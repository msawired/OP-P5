/* global Express */
import { Request, Response, NextFunction } from 'express';

/** Error code the client's apiClient listens for to show the migration notice. */
export const ACCOUNT_MIGRATED = 'ACCOUNT_MIGRATED';

/**
 * 423 Locked: the account is frozen or moved. Deliberately not 403/409, which
 * the client already maps to its stale-session and stale-project modals.
 */
export const ACCOUNT_MIGRATED_STATUS = 423;

export type AccountMigrationState = 'migrating' | 'migrated';

export function newEditorUrl(): string {
  return process.env.NEW_EDITOR_URL || 'https://editor-op.p5js.org';
}

/**
 * Whether migrating/migrated accounts are frozen here. On unless
 * P5_MIGRATION_FREEZE_MIGRATED=false, which testing uses to keep migrated
 * accounts usable for re-migrations. The flag itself is always recorded.
 */
export function migrationFreezeEnabled(): boolean {
  return process.env.P5_MIGRATION_FREEZE_MIGRATED !== 'false';
}

/**
 * The migration state to enforce for this user: null when the account isn't
 * migrating/migrated, or when the freeze is switched off.
 */
export function getMigrationState(
  user: Express.User | undefined | null
): AccountMigrationState | null {
  if (!migrationFreezeEnabled()) return null;
  const state = user?.migration?.state;
  return state === 'migrating' || state === 'migrated' ? state : null;
}

export function accountMigratedBody(state: AccountMigrationState) {
  const url = newEditorUrl();
  return {
    code: ACCOUNT_MIGRATED,
    state,
    newEditorUrl: url,
    message:
      state === 'migrated'
        ? `Your user account is now migrated. Please use the new editor on ${url}`
        : `Your user account is being migrated to the new editor, so changes can't be saved here. Once it's done, please use the new editor on ${url}`
  };
}

const READ_METHODS = ['GET', 'HEAD', 'OPTIONS'];

/**
 * Rejects every write from a user whose account is migrating or migrated,
 * so nothing changes in Mongo after OP took its snapshot. Reads still work.
 * Must run after authentication (passport session or basic auth).
 */
export function rejectIfMigrated(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const state = getMigrationState(req.user);
  if (!state || READ_METHODS.includes(req.method)) {
    next();
    return;
  }
  res.status(ACCOUNT_MIGRATED_STATUS).json(accountMigratedBody(state));
}
