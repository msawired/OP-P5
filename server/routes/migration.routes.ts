import { Router } from 'express';
import * as MigrationController from '../controllers/migration.controller';
import { verifyMigrationSignature } from '../middleware/verifyMigrationSignature';

const router = Router();

// Read-only, server-to-server endpoints for OpenProcessing's migration importer.
router.use(verifyMigrationSignature);

router.get('/manifest/:username', MigrationController.getMigrationManifest);

router.get('/users', MigrationController.listMigrationUsers);

router.post('/status', MigrationController.setMigrationStatus);

// eslint-disable-next-line import/no-default-export
export default router;
