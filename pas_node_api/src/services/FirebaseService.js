'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
const logger = require('../logger');
const config = require('../config');

const log = logger.createChild('firebase-service');

class FirebaseService {
  constructor() {
    this.projectId = config.firebase?.projectId || 'poweradspy-firebase-prod';
    this.credentialPath = path.resolve(config.firebase?.credentialsPath || 'firebase-credentials.json');
    this.accessToken = null;
    this.tokenExpiry = null;
  }

  _loadCredentials() {
    try {
      if (!fs.existsSync(this.credentialPath)) {
        throw new Error(`Firebase credentials file not found at ${this.credentialPath}`);
      }
      return JSON.parse(fs.readFileSync(this.credentialPath, 'utf8'));
    } catch (error) {
      log.error('Failed to load Firebase credentials', { error: error.message });
      throw error;
    }
  }

  async _getAccessToken() {
    if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry - 60000) {
      return this.accessToken;
    }

    try {
      const credentials = this._loadCredentials();
      const now = Math.floor(Date.now() / 1000);

      const header = {
        alg: 'RS256',
        typ: 'JWT',
        kid: credentials.private_key_id
      };

      const payload = {
        iss: credentials.client_email,
        scope: 'https://www.googleapis.com/auth/cloud-platform',
        aud: 'https://oauth2.googleapis.com/token',
        exp: now + 3600,
        iat: now
      };

      const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
      const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

      const signature = require('crypto')
        .createSign('RSA-SHA256')
        .update(`${headerB64}.${payloadB64}`)
        .sign(credentials.private_key, 'base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

      const jwt = `${headerB64}.${payloadB64}.${signature}`;
      const postData = `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`;

      return new Promise((resolve, reject) => {
        const options = {
          hostname: 'oauth2.googleapis.com',
          port: 443,
          path: '/token',
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(postData)
          }
        };

        const req = https.request(options, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              const result = JSON.parse(data);
              if (result.error) {
                reject(new Error(result.error_description));
              } else {
                this.accessToken = result.access_token;
                this.tokenExpiry = Date.now() + (result.expires_in * 1000);
                resolve(result.access_token);
              }
            } catch (e) {
              reject(e);
            }
          });
        });

        req.on('error', reject);
        req.write(postData);
        req.end();
      });
    } catch (error) {
      log.error('Failed to get Firebase access token', { error: error.message });
      throw error;
    }
  }

  async sendNotification(fcmToken, header, text, image = '', actionUrl = '/') {
    try {
      if (!fcmToken) throw new Error('FCM token is required');

      const accessToken = await this._getAccessToken();

      const payload = {
        message: {
          token: fcmToken,
          data: {
            title: header,
            body: text,
            icon: '/assets/imgs/icon-192x192.png',
            action_button: actionUrl,
            image: image
          }
        }
      };

      return new Promise((resolve, reject) => {
        const url = `/v1/projects/${this.projectId}/messages:send`;
        const postData = JSON.stringify(payload);

        const options = {
          hostname: 'fcm.googleapis.com',
          port: 443,
          path: url,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // Byte length, not char length — emoji / non-ASCII would otherwise truncate the body
            'Content-Length': Buffer.byteLength(postData),
            'Authorization': `Bearer ${accessToken}`
          }
        };

        const req = https.request(options, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              const result = JSON.parse(data);
              if (res.statusCode >= 400) {
                log.error('FCM push notification failed', {
                  statusCode: res.statusCode,
                  // Stringify so the real FCM error is visible in logs (was "[object Object]")
                  error: JSON.stringify(result.error || result),
                });
                reject(new Error(result.error?.message || 'FCM error'));
              } else {
                log.info('Push notification sent successfully');
                resolve(result);
              }
            } catch (e) {
              reject(e);
            }
          });
        });

        req.on('error', reject);
        req.write(postData);
        req.end();
      });
    } catch (error) {
      log.error('Error sending push notification', { error: error.message });
      throw error;
    }
  }
}

module.exports = new FirebaseService();
