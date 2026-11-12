/* global Express */
import passport from 'passport';
import { RequestHandler } from 'express';

import { userResponse } from './user.controller';
import {
  ACCOUNT_MIGRATED_STATUS,
  accountMigratedBody,
  getMigrationState
} from '../middleware/rejectIfMigrated';

export const createSession: RequestHandler = (req, res, next) => {
  passport.authenticate('local', (err: Error, user: Express.User) => {
    if (err) {
      next(err);
      return;
    }
    if (!user) {
      res.status(401).json({ message: 'Invalid username or password.' });
      return;
    }
    // A migrated account lives on the new editor; don't start a session here.
    if (getMigrationState(user) === 'migrated') {
      res.status(ACCOUNT_MIGRATED_STATUS).json(accountMigratedBody('migrated'));
      return;
    }

    req.logIn(user, (innerErr: Error) => {
      if (innerErr) {
        next(innerErr);
        return;
      }
      res.json(userResponse(req.user as Express.User));
    });
  })(req, res, next);
};

export const getSession: RequestHandler = (req, res) => {
  if (!req.user) {
    return res.status(200).send({ user: null });
  }
  if (req.user.banned) {
    return res.status(403).send({ message: 'Forbidden: User is banned.' });
  }
  // Covers sessions that existed before the account moved, and GitHub/Google
  // logins, which land here after their redirect.
  if (getMigrationState(req.user) === 'migrated') {
    return res
      .status(ACCOUNT_MIGRATED_STATUS)
      .json(accountMigratedBody('migrated'));
  }

  return res.json(userResponse(req.user));
};

export const destroySession: RequestHandler = (req, res, next) => {
  req.logout((err: Error) => {
    if (err) {
      next(err);
      return;
    }
    (req as any).session.destroy((error: Error) => {
      if (error) {
        next(error);
        return;
      }
      res.json({ success: true });
    });
  });
};
