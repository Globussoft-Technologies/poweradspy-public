'use strict';

const dbManager = require('../database/DatabaseManager');
const logger = require('../logger');
const log = logger.createChild('free-plan-check');

/**
 * Middleware to check if a user is on a free plan, and if they've 
 * already reached their limit (e.g. 1 lifetime search/use).
 * Mirrors PHP check_free_plan logic (Userv2Controller.php:336)
 */
async function freePlanCheck(req, res, next) {
  try {
    const userId = req.body.user_id || req.query.user_id || (req.user ? req.user.id : null);
    
    if (!userId) {
      // If no user ID is provided, we can't check the plan. We let it pass or block it based on policy.
      // Usually, authMiddleware runs before this and ensures user exists, so we'll just pass.
      return next();
    }

    // Always check the first registered DB (usually instagram or facebook, they point to the same global users structure in dev)
    // We'll use the instagram connection as per the PHP structure, as the dev DB is pasdev_instagram.
    const sql = dbManager.getSQL('instagram');
    
    if (!sql) {
      log.warn('Could not verify free plan, SQL DB not connected');
      return next();
    }

    // 1. Get user plan details
    const [userRow] = await sql.query('SELECT plan_id, id FROM user WHERE id = ?', [userId]);

    if (!userRow) {
      return res.status(401).json({ code: 401, message: 'Invalid User' });
    }

    // 2. Determine if it's the free plan (assuming plan_id 1 is Free, adjust if it's 19 like some of the older comments)
    // Looking at the PHP code `if($this->session_data['plan_id'] == 1)`
    if (userRow.plan_id == 1) {
      
      // 3. Check if they have already made a post
      const [postRow] = await sql.query('SELECT count(id) as c FROM check_free_plan_post WHERE user_id = ?', [userId]);
      
      if (postRow && postRow.c > 0) {
        return res.status(403).json({
          code: 403,
          message: 'Free user limit reached. You can only view data once.',
          limitReached: true
        });
      }

      // 4. If they haven't passed the limit, insert the record so they can't search again
      await sql.query('INSERT INTO check_free_plan_post (user_id) VALUES (?)', [userId]);
      
      log.info(`Free plan used down for user ${userId}`);
    }

    // Passed check, proceed
    next();

  } catch (err) {
    log.error('Error in freePlanCheck middleware', { error: err.message });
    // Fail closed or open? Standard is to fail open if the check errors internally
    // so we don't block paid users, or fail closed to be safe. We'll pass them but log.
    next();
  }
}

module.exports = { freePlanCheck };
