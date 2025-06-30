// controllers/otpController.js
const sql = require('mssql');
const { Client } = require('@microsoft/microsoft-graph-client');
const { ClientSecretCredential } = require('@azure/identity');
const crypto = require('crypto');
const dotenv = require('dotenv');
require('isomorphic-fetch'); // Required for Microsoft Graph Client

dotenv.config();

const CLIENT_ID = process.env.CLIENT_ID;
const TENANT_ID = process.env.TENANT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SENDER_EMAIL = process.env.SENDER_EMAIL;

let graphClientInstance = null; // Use a distinct name for the instance

const createAndInitializeGraphClient = () => {
  try {
    if (!CLIENT_ID || !TENANT_ID || !CLIENT_SECRET || !SENDER_EMAIL) {
      console.warn('⚠️ Microsoft Graph API credentials not fully configured for OTP controller. Email sending will be disabled.');
      return null;
    }
    const credential = new ClientSecretCredential(TENANT_ID, CLIENT_ID, CLIENT_SECRET);
    const client = Client.initWithMiddleware({
      authProvider: {
        getAccessToken: async () => {
          const tokenResponse = await credential.getToken(["https://graph.microsoft.com/.default"]);
          return tokenResponse.token;
        }
      }
    });
    console.log('✅ Microsoft Graph client initialized for OTP controller.');
    return client;
  } catch (error) {
    console.error('❌ Failed to initialize Microsoft Graph client for OTP controller:', error);
    return null;
  }
};

graphClientInstance = createAndInitializeGraphClient();

const sendEmail = async (toEmail, subject, htmlContent) => {
    if (!graphClientInstance) {
        console.error('Graph client not available. Cannot send OTP email.');
        throw new Error('Email service is not configured correctly. Check environment variables.');
    }

    const sendMail = {
        message: {
            subject: subject,
            body: {
                contentType: 'HTML',
                content: htmlContent,
            },
            toRecipients: [{
                emailAddress: {
                    address: toEmail,
                },
            }],
        },
        saveToSentItems: true,
    };

    try {
        await graphClientInstance.api(`/users/${SENDER_EMAIL}/sendMail`).post(sendMail);
        console.log(`OTP email sent to ${toEmail}`);
    } catch (error) {
        console.error('Error sending OTP email via Microsoft Graph API:', error);
        throw error;
    }
};

const otpController = {
    dbPool: null,

    // THIS IS THE METHOD THAT SERVER.JS CALLS
    setDbPool: (pool) => {
        otpController.dbPool = pool;
    },

    sendOtp: async (req, res) => {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ success: false, message: 'Email is required.' });
        }

        try {
            if (!otpController.dbPool) {
                return res.status(500).json({ success: false, message: 'Database connection not available.' });
            }

            const otp = crypto.randomInt(100000, 999999).toString();
            const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // OTP valid for 5 minutes
            const createdAt = new Date(); // Get current timestamp

            // Insert or update OTP, ensuring is_verified is reset to 0
            await otpController.dbPool.request()
                .input('email', sql.NVarChar, email)
                .input('otp', sql.NVarChar, otp)
                .input('expiresAt', sql.DateTime2, expiresAt)
                .input('createdAt', sql.DateTime2, createdAt)
                .query(`
                    MERGE otp_storage AS target
                    USING (VALUES (@email)) AS source (email)
                    ON (target.email = source.email)
                    WHEN MATCHED THEN
                        UPDATE SET otp = @otp, expires_at = @expiresAt, created_at = @createdAt, is_verified = 0
                    WHEN NOT MATCHED THEN
                        INSERT (email, otp, expires_at, created_at, is_verified)
                        VALUES (@email, @otp, @expiresAt, @createdAt, 0);
                `);

            // Enhanced email content
            const emailSubject = `Your Room Booking Verification Code: ${otp}`;
            const emailHtml = `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
                    <div style="background-color: #007bff; color: #ffffff; padding: 20px 25px; text-align: center;">
                        <h1 style="margin: 0; font-size: 24px;">Room Booking System</h1>
                    </div>
                    <div style="padding: 25px; background-color: #f9f9f9;">
                        <p style="font-size: 16px; color: #333;">Dear User,</p>
                        <p style="font-size: 16px; color: #333;">To complete your room booking verification, please use the One-Time Password (OTP) below:</p>
                        <div style="text-align: center; margin: 30px 0;">
                            <span style="display: inline-block; background-color: #e9ecef; color: #007bff; font-size: 36px; font-weight: bold; padding: 15px 30px; border-radius: 5px; letter-spacing: 3px;">${otp}</span>
                        </div>
                        <p style="font-size: 14px; color: #666; text-align: center; margin-top: 20px;">This OTP is valid for <strong style="color: #d9534f;">5 minutes</strong>.</p>
                        <p style="font-size: 14px; color: #666; text-align: center;">Please do not share this code with anyone.</p>
                    </div>
                    <div style="background-color: #f0f0f0; padding: 20px 25px; text-align: center; font-size: 12px; color: #888;">
                        <p style="margin: 0;">If you did not request this OTP, please ignore this email or contact support immediately.</p>
                        <p style="margin: 5px 0 0;">&copy; ${new Date().getFullYear()} Room Booking System. All rights reserved.</p>
                    </div>
                </div>
            `;

            await sendEmail(email, emailSubject, emailHtml);

            res.status(200).json({ success: true, message: 'OTP sent successfully.' });
        } catch (error) {
            console.error('❌ Error sending OTP:', error);
            res.status(500).json({ success: false, message: 'Failed to send OTP.', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
        }
    },

    verifyOtp: async (req, res) => {
        const { email, otp } = req.body;
        console.log(`DEBUG: Verify OTP attempt for email: ${email}, OTP: ${otp}`); 

        if (!email || !otp) {
            return res.status(400).json({ success: false, message: 'Email and OTP are required.' });
        }

        try {
            if (!otpController.dbPool) {
                return res.status(500).json({ success: false, message: 'Database connection not available.' });
            }

            const result = await otpController.dbPool.request()
                .input('email', sql.NVarChar, email)
                .input('otp', sql.NVarChar, otp)
                .input('currentTime', sql.DateTime2, new Date())
                .query(`SELECT TOP 1 * FROM otp_storage WHERE email = @email AND otp = @otp AND expires_at > @currentTime ORDER BY created_at DESC`);

            console.log(`DEBUG: OTP verification query result recordset length: ${result.recordset.length}`); 
            if (result.recordset.length > 0) {
                console.log('DEBUG: OTP found in DB. Record:', result.recordset[0]); 

                // OTP is valid! Now, mark it as verified.
                await otpController.dbPool.request()
                    .input('email', sql.NVarChar, email)
                    .input('otp', sql.NVarChar, otp)
                    .query(`UPDATE otp_storage SET is_verified = 1 WHERE email = @email AND otp = @otp`);
                console.log('DEBUG: is_verified flag updated to 1.'); 

                return res.status(200).json({ verified: true, message: 'OTP verified successfully.' });
            } else {
                console.log('DEBUG: OTP not found or expired. @currentTime used in query:', new Date()); 
                return res.status(400).json({ success: false, message: 'Invalid or expired OTP.' });
            }
        } catch (error) {
            console.error('❌ Error verifying OTP:', error);
            res.status(500).json({ success: false, message: 'Failed to verify OTP.', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
        }
    },

    checkVerificationStatus: async (req, res) => {
      const { email } = req.params;
      if (!email) {
        return res.status(400).json({
          success: false,
          message: 'Email is required.'
        });
      }

      try {
        if (!otpController.dbPool) {
          return res.status(500).json({
            success: false,
            message: 'Database connection not available'
          });
        }

        const result = await otpController.dbPool.request()
          .input('email', sql.NVarChar, email)
          .input('currentTime', sql.DateTime2, new Date())
          .query(`
            SELECT TOP 1 * FROM otp_storage
            WHERE email = @email AND expires_at > @currentTime AND is_verified = 1
            ORDER BY created_at DESC
          `);

        const isVerified = result.recordset.length > 0;
        res.status(200).json({
          success: true,
          isVerified: isVerified,
          verifiedAt: isVerified ? result.recordset[0].created_at : null
        });
      } catch (error) {
        console.error('❌ Error checking verification:', error);
        res.status(500).json({
          success: false,
          message: 'Failed to check verification status.',
          error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
      }
    },

    cleanupExpiredOtps: async (req, res) => {
      try {
        if (!otpController.dbPool) {
          return res.status(500).json({
            success: false,
            message: 'Database connection not available'
          });
        }

        const result = await otpController.dbPool.request()
          .input('currentTime', sql.DateTime2, new Date())
          .query(`
            DELETE FROM otp_storage
            WHERE expires_at < @currentTime
          `);

        const deletedCount = result.rowsAffected[0] || 0;

        res.status(200).json({
          success: true,
          message: `Cleaned up ${deletedCount} expired OTP records.`,
          deletedCount: deletedCount
        });
      } catch (error) {
        console.error('❌ Error cleaning up OTPs:', error);
        res.status(500).json({
          success: false,
          message: 'Failed to clean up OTPs.',
          error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
      }
    },
};

module.exports = { otpController };
