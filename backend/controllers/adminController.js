// controllers/adminController.js
const sql = require('mssql');
const { Client } = require('@microsoft/microsoft-graph-client');
const { ClientSecretCredential } = require('@azure/identity');
const bcrypt = require('bcrypt'); // Note: Not used for hardcoded password in this example
const dotenv = require('dotenv');
require('isomorphic-fetch'); // Polyfill fetch for Node.js if not available

dotenv.config(); // Load environment variables

// Microsoft Graph API credentials from environment variables
const CLIENT_ID = process.env.CLIENT_ID;
const TENANT_ID = process.env.TENANT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SENDER_EMAIL = process.env.SENDER_EMAIL; // The email address to send emails from

// Hardcoded admin credentials for demonstration purposes (DO NOT USE IN PRODUCTION)
const ADMIN_EMAIL = 'admin@admin.com';
const ADMIN_PASSWORD = '1234'; 

let graphClient = null; // Microsoft Graph client instance

// Initializes the Microsoft Graph client for sending emails.
// It checks if all necessary credentials are provided.
const initializeGraphClient = () => {
    try {
        if (!CLIENT_ID || !TENANT_ID || !CLIENT_SECRET || !SENDER_EMAIL) {
            console.warn('⚠️ Microsoft Graph API credentials not fully configured for adminController. Email sending may not work. (CLIENT_ID, TENANT_ID, CLIENT_SECRET, SENDER_EMAIL are required)');
            return null; // Return null if not configured
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
        console.log('✅ Microsoft Graph client initialized for Admin Controller.');
        return client;
    } catch (error) {
        console.error('❌ Failed to initialize Microsoft Graph client for Admin Controller:', error);
        return null;
    }
};

graphClient = initializeGraphClient(); // Initialize client on startup

// Send email helper function (similar to bookingController but using admin's client)
const sendEmail = async (toEmail, subject, htmlContent) => {
    if (!graphClient) {
        console.error('Admin Graph client not available. Cannot send email.');
        throw new Error('Email service is not configured for admin functions.');
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
        await graphClient.api(`/users/${SENDER_EMAIL}/sendMail`).post(sendMail);
        console.log(`Admin email sent to ${toEmail}`);
    } catch (error) {
        console.error('Error sending admin email via Microsoft Graph API:', error);
        throw error;
    }
};


const adminController = {
    dbPool: null, // This will be set by server.js

    // New: Method to inject the database connection pool
    setDbPool: (pool) => {
      adminController.dbPool = pool;
    },

    adminLogin: async (req, res) => {
        const { email, password } = req.body;

        // Basic validation
        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'Email and password are required.' });
        }

        // Hardcoded admin check (REPLACE WITH REAL AUTHENTICATION)
        if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
            // In a real app, generate a JWT here
            return res.status(200).json({ success: true, message: 'Admin login successful.', token: 'simulated_admin_token' });
        } else {
            return res.status(401).json({ success: false, message: 'Invalid admin credentials.' });
        }
    },

    getAllBookings: async (req, res) => {
        try {
            if (!adminController.dbPool) {
                return res.status(500).json({ success: false, message: 'Database connection not available.' });
            }
            const result = await adminController.dbPool.request().query('SELECT * FROM room_bookings ORDER BY created_at DESC');
            res.status(200).json({ success: true, data: result.recordset, count: result.recordset.length });
        } catch (error) {
            console.error('Error fetching all bookings (admin view):', error);
            res.status(500).json({ success: false, message: 'Failed to fetch all bookings.' });
        }
    },

    deleteBooking: async (req, res) => {
        const { eventId } = req.params; // Using event_id (UUID string) as identifier

        if (!eventId) {
            return res.status(400).json({ success: false, message: 'Event ID is required for deletion.' });
        }

        let transaction;
        try {
            if (!adminController.dbPool) {
                return res.status(500).json({ success: false, message: 'Database connection not available.' });
            }

            transaction = new sql.Transaction(adminController.dbPool);
            await transaction.begin();
            const request = new sql.Request(transaction);

            // Fetch booking details before cancelling for the email
            const bookingResult = await request
                .input('eventId', sql.NVarChar, eventId)
                .query(`
                    SELECT subject, room_name, start_datetime, end_datetime, organizer_email
                    FROM room_bookings
                    WHERE event_id = @eventId AND status = 'confirmed';
                `);

            const bookingToCancel = bookingResult.recordset[0];

            if (!bookingToCancel) {
                await transaction.rollback();
                return res.status(404).json({ success: false, message: 'Booking not found or already cancelled.' });
            }

            // Update the status to 'cancelled' and set cancelled_at timestamp
            const updateResult = await request
                .input('eventIdToCancel', sql.NVarChar, eventId)
                .query(`
                    UPDATE room_bookings
                    SET status = 'cancelled', cancelled_at = GETUTCDATE(), updated_at = GETUTCDATE()
                    WHERE event_id = @eventIdToCancel;
                `);

            if (updateResult.rowsAffected[0] === 0) {
                await transaction.rollback();
                return res.status(400).json({ success: false, message: 'Failed to update booking status to cancelled.' });
            }

            await transaction.commit(); // Commit the transaction

            // Send cancellation email to the organizer
            const cancellationSubject = `Your Room Booking for "${bookingToCancel.subject}" Has Been Cancelled (Admin Action)`;
            const cancellationHtml = `
                <p>Dear ${bookingToCancel.organizer_email.split('@')[0]},</p>
                <p>Please be informed that your room booking for <strong>${bookingToCancel.room_name}</strong></p>
                <p>scheduled from <strong>${new Date(bookingToCancel.start_datetime).toLocaleString()}</strong> to <strong>${new Date(bookingToCancel.end_datetime).toLocaleString()}</strong>
                has been cancelled by the administrator.</p>
                <p>If you have any questions, please contact support.</p>
                <p>Thank you.</p>
            `;
            await sendEmail(bookingToCancel.organizer_email, cancellationSubject, cancellationHtml);

            res.status(200).json({ success: true, message: 'Booking cancelled by admin successfully.' });

        } catch (error) {
            if (transaction && transaction.rolledBack === false) {
                try {
                    await transaction.rollback();
                } catch (rollbackError) {
                    console.error('Error during transaction rollback for admin deleteBooking:', rollbackError);
                }
            }
            console.error('Error deleting booking by admin:', error);
            res.status(500).json({ success: false, message: error.message || 'Failed to delete booking by admin.' });
        }
    },

    sendRescheduleEmail: async (req, res) => {
        const { bookingId, organizerEmail, subject, message } = req.body;

        if (!bookingId || !organizerEmail || !subject || !message) {
            return res.status(400).json({ success: false, message: 'Booking ID, organizer email, subject, and message are required.' });
        }

        try {
            // For sending reschedule email, we don't necessarily need the dbPool for this specific action
            // as it's just sending an email. However, you might want to fetch booking details for context.
            // Assuming the `message` from frontend already contains all necessary details.

            const emailHtml = `
                <p>Dear ${organizerEmail.split('@')[0]},</p>
                <p>Regarding your booking (ID: ${bookingId}):</p>
                <p><strong>Subject:</strong> ${subject}</p>
                <p><strong>Message from Administrator:</strong></p>
                <div style="border: 1px solid #ccc; padding: 10px; margin: 15px 0; background-color: #f9f9f9;">
                    <p>${message}</p>
                </div>
                <p>Please contact us to discuss rescheduling or other options.</p>
                <p>Thank you.</p>
            `;

            await sendEmail(organizerEmail, `RE: ${subject}`, emailHtml);

            res.status(200).json({ success: true, message: 'Reschedule email sent successfully.' });
        } catch (error) {
            console.error('Error sending reschedule email:', error);
            res.status(500).json({ success: false, message: error.message || 'Failed to send reschedule email.' });
        }
    },

    createBookingAdmin: async (req, res) => {
        const {
            room_id, room_name, subject, organizer_email,
            start_datetime, end_datetime, total_participants,
            internal_participants, external_participants, meeting_type,
            attendee_emails // This will be a JSON string from frontend
        } = req.body;

        if (!room_id || !room_name || !subject || !organizer_email || !start_datetime || !end_datetime || !total_participants) {
            return res.status(400).json({ success: false, message: 'Missing required fields for admin booking.' });
        }

        try {
            if (!adminController.dbPool) {
                return res.status(500).json({ success: false, message: 'Database connection not available.' });
            }

            // Generate a unique event_id
            const event_id = crypto.randomUUID();

            // Insert the new booking
            await adminController.dbPool.request()
                .input('event_id', sql.NVarChar, event_id)
                .input('room_id', sql.Int, room_id) // Changed to sql.Int
                .input('room_name', sql.NVarChar, room_name)
                .input('subject', sql.NVarChar, subject)
                .input('organizer_email', sql.NVarChar, organizer_email)
                .input('start_datetime', sql.DateTime, new Date(start_datetime)) // Assuming these are UTC ISO strings
                .input('end_datetime', sql.DateTime, new Date(end_datetime))     // Assuming these are UTC ISO strings
                .input('total_participants', sql.Int, total_participants)
                .input('internal_participants', sql.Int, internal_participants)
                .input('external_participants', sql.Int, external_participants)
                .input('meeting_type', sql.NVarChar, meeting_type || 'in-person') // Default if not provided
                .input('attendee_emails', sql.NVarChar, attendee_emails || '[]') // Store as JSON string or empty array string
                .input('status', sql.NVarChar, 'confirmed') // Admin bookings are confirmed by default
                .input('created_at', sql.DateTime, new Date()) // This line ensures created_at is sent as UTC
                .query(`
                    INSERT INTO room_bookings (event_id, room_id, room_name, subject, organizer_email, start_datetime, end_datetime, total_participants, internal_participants, external_participants, meeting_type, attendee_emails, status, created_at)
                    VALUES (@event_id, @room_id, @room_name, @subject, @organizer_email, @start_datetime, @end_datetime, @total_participants, @internal_participants, @external_participants, @meeting_type, @attendee_emails, @status, @created_at)
                `);

            res.status(201).json({ success: true, message: 'Booking created by admin successfully.', event_id: event_id });

        } catch (error) {
            console.error('Error creating booking by admin:', error);
            res.status(500).json({ success: false, message: error.message || 'Failed to create booking by admin.' });
        }
    },
};

// IMPORTANT: Export the controller object so it can be destructured and used in server.js
module.exports = { adminController };
