'use strict';

const config = require('../../../config');
const { generateToken } = require('../../../middleware/auth');

async function adminLogin(req, res, logger) {
  try {
    const { username, password } = req.body;

    logger?.debug?.('[adminLogin] Login attempt:', { username });

    // Get credentials from config (priority) or environment variables
    const adminUser = config.adminUserActivity?.username || process.env.PAS_ADMIN_USERNAME || 'Admin';
    const adminPass = config.adminUserActivity?.password || process.env.PAS_ADMIN_PASSWORD || 'Admin@123';

    // Validate input
    if (!username || !password) {
      logger?.warn?.('[adminLogin] Missing username or password');
      return { code: 400, message: 'Username and password are required' };
    }

    // Check credentials
    if (username !== adminUser || password !== adminPass) {
      logger?.warn?.('[adminLogin] Invalid credentials for user:', username);
      return { code: 400, message: 'Username or password incorrect' };
    }

    // Generate JWT token
    const token = generateToken({ user_name: username, role: 'admin' });

    logger?.info?.('[adminLogin] User logged in successfully:', username);

    return {
      code: 200,
      message: 'Logged in successfully.',
      data: { token }
    };
  } catch (err) {
    logger?.error?.('[adminLogin] Error:', err.message);
    return { code: 500, message: 'Internal server error', error: err.message };
  }
}

module.exports = { adminLogin };
