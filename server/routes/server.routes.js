import { Router } from 'express';
import { renderIndex, sendHtml } from '../views/index';
import {
  collectionExists,
  sketchExists,
  userExists
} from '../utils/opResource';

const router = Router();

// After the OpenProcessing migration the editor server no longer has its own
// database, so every route here serves the same React SPA shell and the app
// fetches the data it needs (sketches, users, collections, auth) from
// OpenProcessing in the browser using the per-user access token.
//
// The shell still has to be sent with the right status code: routes naming a
// sketch, user or collection ask OP whether it exists and serve the 404 page
// when it doesn't, so crawlers don't see a 200 for every URL. See
// server/utils/opResource.js for what counts as missing.
const renderSpa = (req, res) => res.send(renderIndex());

const renderSpaIfExists = (check) => async (req, res, next) => {
  try {
    await sendHtml(req, res, await check(req.params));
  } catch (error) {
    next(error);
  }
};

router.get('/', renderSpa);
router.get('/signup', renderSpa);
router.get(
  '/projects/:project_id',
  renderSpaIfExists(({ project_id: projectId }) => sketchExists(projectId))
);
router.get(
  '/:username/sketches/:project_id/add-to-collection',
  renderSpaIfExists(({ project_id: projectId, username }) =>
    sketchExists(projectId, username)
  )
);
router.get(
  '/:username/sketches/:project_id',
  renderSpaIfExists(({ project_id: projectId, username }) =>
    sketchExists(projectId, username)
  )
);
router.get(
  '/:username/sketches',
  renderSpaIfExists(({ username }) => userExists(username))
);
router.get(
  '/:username/full/:project_id',
  renderSpaIfExists(({ project_id: projectId, username }) =>
    sketchExists(projectId, username)
  )
);
router.get(
  '/full/:project_id',
  renderSpaIfExists(({ project_id: projectId }) => sketchExists(projectId))
);
router.get('/login', renderSpa);
router.get('/sketches', renderSpa);
router.get('/assets', renderSpa);
router.get(
  '/:username/assets',
  renderSpaIfExists(({ username }) => userExists(username))
);
router.get('/account', renderSpa);
router.get('/about', renderSpa);
router.get(
  '/:username/collections/:id',
  renderSpaIfExists(({ id, username }) => collectionExists(id, username))
);
router.get(
  '/:username/collections',
  renderSpaIfExists(({ username }) => userExists(username))
);
router.get('/privacy-policy', renderSpa);
router.get('/terms-of-use', renderSpa);
router.get('/code-of-conduct', renderSpa);

// eslint-disable-next-line import/no-default-export
export default router;
