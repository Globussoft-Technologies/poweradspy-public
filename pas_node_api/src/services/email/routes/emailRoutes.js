'use strict';

/**
 * Email service routes — mounted at /api/v1/email (see app.js).
 *
 *   POST /api/v1/email/unsubscribe   { email }   (also accepts ?email=)
 *   GET  /api/v1/email/unsubscribe   ?email=                ← direct-link friendly
 *   POST /api/v1/email/resubscribe   { email }
 *
 * Public (no auth) — the unsubscribe link in outgoing mail must work without a
 * logged-in session, exactly like the old PHP /Mails_status flow.
 */

const { Router } = require('express');
const ctrl = require('../controllers/unsubscribeController');

const router = Router();

router.post('/unsubscribe', ctrl.unsubscribe);
router.get('/unsubscribe', ctrl.unsubscribe);
router.post('/resubscribe', ctrl.resubscribe);

module.exports = router;
