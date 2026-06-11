'use strict';

const axios = require('axios');
const logger = require('../logger');
const config = require('../config');

const log = logger.createChild('email-service');

class EmailService {
  constructor() {
    this.sendGridApiKey = config.sendgrid?.apiKey;
    this.fromEmail = config.sendgrid?.fromEmail || 'noreply@poweradspy.com';
    this.fromName = config.sendgrid?.fromName || 'PowerAdSpy';
  }

  async sendDailyMailUpdate(email, userName, platforms, keywords, ads) {
    try {
      if (!email) throw new Error('Email is required');

      const htmlContent = this._buildEmailTemplate(userName, platforms, keywords, ads);

      const payload = {
        personalizations: [
          {
            to: [{ email: email, name: userName }],
            subject: `PowerAdSpy Daily Update - New Ads Found!`
          }
        ],
        from: {
          email: this.fromEmail,
          name: this.fromName
        },
        content: [
          {
            type: 'text/html',
            value: htmlContent
          }
        ]
      };

      const response = await axios.post('https://api.sendgrid.com/v3/mail/send', payload, {
        headers: {
          'Authorization': `Bearer ${this.sendGridApiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });

      log.info('Email sent successfully', { email, userName });
      return { status: true, email, message: 'Email sent successfully' };
    } catch (error) {
      log.error('Failed to send email', { email, error: error.message });
      return { status: false, email, message: error.message };
    }
  }

  _buildEmailTemplate(userName, platforms, keywords, ads) {
    // Build keywords HTML with styled buttons
    let keywordsButtonsHtml = '';
    Object.entries(keywords).forEach(([platform, kwords]) => {
      keywordsButtonsHtml += `
        <tr>
          <td style="padding: 15px 30px; background: #fff; font-family: Arial, Helvetica, sans-serif; font-size: 15px; color: #303030;">
            <span><b>For ${platform.toUpperCase()}</b></span>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding: 10px 30px; background: #fff;">
            <table cellpadding="0" cellspacing="0" border="0" style="display: inline-block;">
              <tr>
                ${kwords.map(key => `
                  <td style="padding: 5px;">
                    <a href="${process.env.APP_URL || 'http://localhost:5173'}/${platform}/landing/key/${key}"
                       style="padding: 8px 20px; background-color: #326de7; color: white; text-decoration: none; border-radius: 6px; font-weight: 500; display: inline-block;">
                      ${key}
                    </a>
                  </td>
                `).join('')}
              </tr>
            </table>
          </td>
        </tr>
      `;
    });

    // Build ads HTML with card style
    let adsHtml = '';
    if (ads && ads.image_url && ads.image_url.length > 0) {
      adsHtml = `
        <tr>
          <td align="center" style="padding: 20px;">
            <table cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width: 540px;" align="center">
              <tr>
                ${ads.image_url.map((img, idx) => `
                  <td align="center" valign="top" width="33.33%" style="padding: 5px;">
                    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); background: #fff;">
                      <tr>
                        <td style="padding: 12px 15px; background-color: #f8f8f8; border-bottom: 2px solid #0f48d5; font-family: Arial, sans-serif; font-size: 13px; color: #303030; font-weight: bold; max-height: 40px; overflow: hidden; text-align: center;">
                          ${ads.title?.[idx]?.substring(0, 30) || 'Ad'} ${(ads.title?.[idx]?.length || 0) > 30 ? '...' : ''}
                        </td>
                      </tr>
                      <tr>
                        <td style="height: 120px; width: 100%; overflow: hidden; background-color: #f0f0f0;">
                          <a href="${process.env.APP_URL || 'http://localhost:5173'}/linkedin/set-cookie-mail?adId=${ads.adId?.[idx] || ''}" style="text-decoration: none; display: block;">
                            <img src="${img}" alt="Ad ${idx + 1}" width="100%" style="width: 100%; height: 120px; object-fit: cover; display: block;">
                          </a>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 12px 15px; background-color: #ffffff; border-top: 1px solid #f0f0f0; font-family: Arial, sans-serif; font-size: 12px; color: #6a6a6a; text-align: center; line-height: 1.4; max-height: 60px; overflow: hidden;">
                          ${ads.text?.[idx]?.substring(0, 30) || 'Ad text'} ${(ads.text?.[idx]?.length || 0) > 30 ? '...' : ''}
                        </td>
                      </tr>
                    </table>
                  </td>
                `).join('')}
              </tr>
            </table>
          </td>
        </tr>
      `;
    } else {
      adsHtml = `
        <tr>
          <td align="center" style="padding: 30px; background: #fff; font-family: Arial, sans-serif; font-size: 14px; color: #6a6a6a;">
            No ads found yet
          </td>
        </tr>
      `;
    }

    return `
      <!DOCTYPE html>
      <html xmlns="http://www.w3.org/1999/xhtml">
      <head>
        <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>PowerAdSpy Daily Update</title>
        <style type="text/css">
          body { margin: 0; padding: 0; background-color: #f8f8f8; }
          .ReadMsgBody { width: 100%; background-color: #f8f8f8; }
          .ExternalClass { width: 100%; background-color: #f8f8f8; }
          table { border-collapse: collapse; }
          a { color: #1D6AD2; text-decoration: none; }
          a:hover { color: #aaa; }
          @media only screen and (max-width: 640px) {
            table table { width: 100% !important; }
            td[class=full_width] { width: 100% !important; }
            img[class=img_scale] { width: 100% !important; height: auto !important; }
          }
        </style>
      </head>
      <body bgcolor="#f8f8f8">
        <!-- HEADER -->
        <table align="center" bgcolor="#fff" cellpadding="0" cellspacing="0" border="0" width="600" style="margin-top: 20px;">
          <tr>
            <td align="center" style="padding: 30px; text-align: center;">
              <img src="https://poweradspy.com/wp-content/uploads/2023/08/poweradspy-logo-4.png"
                   alt="PowerAdSpy Logo" width="200" style="max-width: 200px; height: auto;">
            </td>
          </tr>
        </table>

        <!-- MAIN CONTENT -->
        <table align="center" bgcolor="#fff" cellpadding="0" cellspacing="0" border="0" width="600">
          <!-- GREETING -->
          <tr>
            <td style="padding: 20px 30px; background: #fff; font-family: Arial, Helvetica, sans-serif; font-size: 16px; color: #303030; line-height: 24px;">
              <b>Hello, ${userName}!</b>
            </td>
          </tr>

          <!-- INTRO TEXT -->
          <tr>
            <td style="padding: 0px 30px 15px 30px; background: #fff; font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #6a6a6a; line-height: 22px;">
              We hope you are having great success with your marketing campaigns. <br><br>
              <b style="color: #303030;">We've curated some new ads for you based on your recent search.</b>
            </td>
          </tr>

          <!-- KEYWORDS SECTION -->
          <tr>
            <td style="padding: 15px 30px; background: #fff; font-family: Arial, Helvetica, sans-serif; font-size: 15px; color: #303030; font-weight: bold;">
              Click below keywords to check the latest ads:
            </td>
          </tr>

          ${keywordsButtonsHtml}

          <!-- ADS SECTION -->
          ${adsHtml}

          <!-- CLOSING MESSAGE -->
          <tr>
            <td align="center" style="padding: 20px 30px; background: #fff; font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #6a6a6a; line-height: 22px;">
              <b style="color: #303030;">We hope that this will help you to make your ad campaigns better.</b>
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="padding: 20px 30px; background: #fff; font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #303030; text-align: center; border-top: 1px solid #f0f0f0;">
              Regards,<br>
              <b>Team PowerAdSpy</b>
            </td>
          </tr>

          <!-- CONTACT -->
          <tr>
            <td align="center" style="padding: 15px; background: #fff; font-family: Arial, sans-serif; font-size: 13px;">
              <a href="mailto:support@poweradspy.com" style="color: #242424; text-decoration: none;">
                📧 support@poweradspy.com
              </a>
            </td>
          </tr>

          <!-- UNSUBSCRIBE -->
          <tr>
            <td align="left" style="padding: 20px 30px; background: #fff; font-family: Arial, sans-serif; font-size: 12px;">
              <a href="${process.env.APP_URL || 'http://localhost:5173'}/facebook/unsubscribe-page?email=${encodeURIComponent(userName)}"
                 style="color: #888888; text-decoration: underline;">
                Unsubscribe
              </a>
            </td>
          </tr>
        </table>

        <!-- FOOTER SPACER -->
        <table align="center" bgcolor="#f8f8f8" cellpadding="0" cellspacing="0" border="0" width="600">
          <tr>
            <td height="40">&nbsp;</td>
          </tr>
        </table>
      </body>
      </html>
    `;
  }
}

module.exports = new EmailService();
