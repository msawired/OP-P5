import { Router } from 'express';
import passport from 'passport';
import * as ProjectController from '../controllers/project.controller';
import { rejectIfMigrated } from '../middleware/rejectIfMigrated';

const router = Router();

router.get(
  '/:username/sketches',
  passport.authenticate('basic', { session: false }),
  ProjectController.apiGetProjectsForUser
);

router.post(
  '/:username/sketches',
  passport.authenticate('basic', { session: false }),
  rejectIfMigrated,
  ProjectController.apiCreateProject
);

// NOTE: Currently :username will not be checked for ownership
//       only the project's owner in the database.
router.delete(
  '/:username/sketches/:project_id',
  passport.authenticate('basic', { session: false }),
  rejectIfMigrated,
  ProjectController.deleteProject
);

// eslint-disable-next-line import/no-default-export
export default router;
