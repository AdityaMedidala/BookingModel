// controllers/bookingController.js

const sql = require('mssql');
const crypto = require('crypto');
const dotenv = require('dotenv');
const { ConfidentialClientApplication } = require('@azure/msal-node');
const axios = require('axios');

dotenv.config();

// Microsoft Graph API configuration
const msalConfig = {
  auth: {
    clientId: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    authority: `https://login.microsoftonline.com/${process.env.TENANT_ID}`
  }
};

const msalClient = new ConfidentialClientApplication(msalConfig);

// Get access token for Graph API
const getGraphAccessToken = async () => {
  try {
    const clientCredentialRequest = {
      scopes: ['https://graph.microsoft.com/.default'],
    };
    try {
      const response = await msalClient.acquireTokenSilent(clientCredentialRequest);
      return response.accessToken;
    } catch (silentError) {
      console.log('Silent token acquisition failed, acquiring token using client credentials');
      const response = await msalClient.acquireTokenByClientCredential(clientCredentialRequest);
      return response.accessToken;
    }
  } catch (error) {
    console.error('Failed to acquire access token:', error);
    throw error;
  }
};

// Send email using Microsoft Graph API
const sendEmail = async (toEmail, subject, htmlContent) => {
  if (!process.env.SENDER_EMAIL || !process.env.CLIENT_ID || !process.env.CLIENT_SECRET || !process.env.TENANT_ID) {
    console.warn('Email sending skipped: Microsoft Graph API credentials not fully configured.');
    return; // Do not throw, just skip email if not configured
  }

  try {
    const accessToken = await getGraphAccessToken();
    const graphApiUrl = `https://graph.microsoft.com/v1.0/users/${process.env.SENDER_EMAIL}/sendMail`;

    const emailPayload = {
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

    await axios.post(graphApiUrl, emailPayload, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });
    console.log(`✅ Email sent successfully to ${toEmail}`);
  } catch (error) {
    console.error('❌ Error sending email:', error.response?.data || error.message);
    throw new Error('Failed to send email notification.');
  }
};

const bookingController = {
  dbPool: null, 

  setDbPool: (pool) => {
    bookingController.dbPool = pool;
  },

  getAllBookings: async (req, res) => {
    try {
      if (!bookingController.dbPool) {
        return res.status(500).json({ message: 'Database connection not available' });
      }
      const result = await bookingController.dbPool.request().query('SELECT * FROM room_bookings ORDER BY start_datetime DESC');
      res.status(200).json({ success: true, data: result.recordset, count: result.recordset.length });
    } catch (error) {
      console.error('Error fetching all bookings:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch all bookings.' });
    }
  },

  getBookingsByRoomAndDate: async (req, res) => {
    const { roomId, startDate } = req.query; 

    if (!roomId || !startDate) {
      return res.status(400).json({ success: false, message: 'Room ID and start date are required.' });
    }

    try {
      if (!bookingController.dbPool) {
        return res.status(500).json({ message: 'Database connection not available' });
      }

      // The frontend sends a YYYY-MM-DD string. We create the day's boundaries in the target timezone (IST)
      // which creates Date objects with the correct underlying UTC timestamp.
      const dateOnly = startDate.split('T')[0];
      const istStartOfDay = new Date(`${dateOnly}T00:00:00.000+05:30`); 
      const istEndOfDay = new Date(`${dateOnly}T23:59:59.999+05:30`);   

      const result = await bookingController.dbPool.request()
        .input('roomId', sql.Int, parseInt(roomId)) 
        // These Date objects are passed directly. The mssql driver handles them correctly.
        .input('startDate', sql.DateTime, istStartOfDay) 
        .input('endDate', sql.DateTime, istEndOfDay)    
        .query(`
          SELECT event_id, room_id, room_name, subject, organizer_email, start_datetime, end_datetime, total_participants, internal_participants, external_participants, meeting_type, attendee_emails, status
          FROM room_bookings
          WHERE room_id = @roomId
          AND status = 'confirmed'
          AND (start_datetime < @endDate AND end_datetime > @startDate)
          ORDER BY start_datetime ASC;
        `);

      res.status(200).json(result.recordset);
    } catch (error) {
      console.error('Error fetching bookings by room and date:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch room availability.' });
    }
  },

  getBookingsByEmail: async (req, res) => {
    const { email } = req.params;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required.'
      });
    }

    try {
      if (!bookingController.dbPool) {
        return res.status(500).json({ message: 'Database connection not available' });
      }

      const result = await bookingController.dbPool.request()
        .input('organizer_email', sql.NVarChar, email)
        .query(`
          SELECT * FROM room_bookings
          WHERE organizer_email = @organizer_email AND status = 'confirmed'
          ORDER BY start_datetime ASC
        `);

      res.status(200).json({
        success: true,
        data: result.recordset,
        count: result.recordset.length
      });

    } catch (error) {
      console.error('Error fetching bookings by email:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch bookings by email.',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  },

  createBooking: async (req, res) => {
    const {
      room_id,
      room_name,
      subject,
      description,
      organizer_email,
      start_datetime, 
      end_datetime,   
      total_participants,
      internal_participants,
      external_participants,
      meeting_type,
      attendee_emails,
    } = req.body;

    if (!room_id || !subject || !organizer_email || !start_datetime || !end_datetime || !total_participants) {
      return res.status(400).json({ success: false, message: 'Missing required booking fields.' });
    }

    try {
      if (!bookingController.dbPool) {
        return res.status(500).json({ message: 'Database connection not available' });
      }

      const roomCheck = await bookingController.dbPool.request()
        .input('roomId', sql.Int, parseInt(room_id)) 
        .query('SELECT capacity FROM rooms WHERE id = @roomId');

      if (roomCheck.recordset.length === 0) {
        return res.status(404).json({ success: false, message: 'Room not found.' });
      }
      const roomCapacity = roomCheck.recordset[0].capacity;

      if (total_participants > roomCapacity) {
        return res.status(400).json({ success: false, message: `Total participants exceed room capacity of ${roomCapacity}.` });
      }

      const bookingStartUtc = new Date(start_datetime);
      const bookingEndUtc = new Date(end_datetime);

      const availabilityCheck = await bookingController.dbPool.request()
        .input('roomId', sql.Int, parseInt(room_id)) 
        .input('start_datetime', sql.DateTime, bookingStartUtc) 
        .input('end_datetime', sql.DateTime, bookingEndUtc)     
        .query(`
          SELECT COUNT(*) AS count FROM room_bookings
          WHERE room_id = @roomId AND status = 'confirmed'
          AND (start_datetime < @end_datetime AND end_datetime > @start_datetime);
        `);

      if (availabilityCheck.recordset[0].count > 0) {
        return res.status(409).json({ success: false, message: 'The room is already booked for the selected time slot.' });
      }

      const event_id = crypto.randomUUID();

      await bookingController.dbPool.request()
        .input('event_id', sql.NVarChar, event_id)
        .input('room_id', sql.Int, parseInt(room_id)) 
        .input('room_name', sql.NVarChar, room_name)
        .input('subject', sql.NVarChar, subject)
        .input('description', sql.NVarChar, description || null)
        .input('organizer_email', sql.NVarChar, organizer_email)
        .input('start_datetime', sql.DateTime, bookingStartUtc) 
        .input('end_datetime', sql.DateTime, bookingEndUtc)     
        .input('total_participants', sql.Int, total_participants)
        .input('internal_participants', sql.Int, internal_participants || null)
        .input('external_participants', sql.Int, external_participants || null)
        .input('meeting_type', sql.NVarChar, meeting_type || 'in-person')
        .input('attendee_emails', sql.NVarChar, attendee_emails || '[]')
        .input('status', sql.NVarChar, 'confirmed')
        .input('created_at', sql.DateTime, new Date()) // Add this line
        .query(`
          INSERT INTO room_bookings (event_id, room_id, room_name, subject, description, organizer_email, start_datetime, end_datetime, total_participants, internal_participants, external_participants, meeting_type, attendee_emails, status, created_at)
          VALUES (@event_id, @room_id, @room_name, @subject, @description, @organizer_email, @start_datetime, @end_datetime, @total_participants, @internal_participants, @external_participants, @meeting_type, @attendee_emails, @status, @created_at);
        `);

      const confirmationSubject = `Booking Confirmed: ${subject} at ${room_name}`;
      const confirmationHtml = `
        <p>Dear ${organizer_email.split('@')[0]},</p>
        <p>Your room booking has been successfully confirmed!</p>
        <p><strong>Booking Details:</strong></p>
        <ul>
          <li><strong>Room:</strong> ${room_name}</li>
          <li><strong>Subject:</strong> ${subject}</li>
          <li><strong>Time:</strong> ${new Date(start_datetime).toLocaleString()} - ${new Date(end_datetime).toLocaleString()}</li>
          <li><strong>Total Participants:</strong> ${total_participants}</li>
        </ul>
        <p>Thank you!</p>
      `;
      await sendEmail(organizer_email, confirmationSubject, confirmationHtml);

      res.status(201).json({ success: true, message: 'Booking created and confirmed successfully!', event_id });

    } catch (error) {
      console.error('Error creating booking:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to create booking.',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  },

  updateBooking: async (req, res) => {
    const { eventId } = req.params; 
    const {
      room_id,
      subject,
      description,
      organizer_email,
      start_datetime, 
      end_datetime,   
      total_participants,
      internal_participants,
      external_participants,
      meeting_type,
      attendee_emails,
    } = req.body; 

    if (!eventId || !room_id || !subject || !organizer_email || !start_datetime || !end_datetime || !total_participants) {
      return res.status(400).json({ success: false, message: 'Missing required fields for booking update.' });
    }

    let transaction;
    try {
        if (!bookingController.dbPool) {
            return res.status(500).json({ message: 'Database connection not available' });
        }

        transaction = new sql.Transaction(bookingController.dbPool);
        await transaction.begin();
        const request = new sql.Request(transaction);

        const existingBookingResult = await request
            .input('eventId', sql.NVarChar, eventId)
            .query('SELECT * FROM room_bookings WHERE event_id = @eventId AND status = \'confirmed\'');

        const existingBooking = existingBookingResult.recordset[0];
        if (!existingBooking) {
            await transaction.rollback();
            return res.status(404).json({ success: false, message: 'Original booking not found or already cancelled.' });
        }
        
        const roomCheck = await request
          .input('newRoomId', sql.Int, parseInt(room_id)) 
          .query('SELECT capacity, name FROM rooms WHERE id = @newRoomId');

        if (roomCheck.recordset.length === 0) {
          await transaction.rollback();
          return res.status(404).json({ success: false, message: 'The specified room could not be found.' }); 
        }
        const newRoomCapacity = roomCheck.recordset[0].capacity;
        const newRoomName = roomCheck.recordset[0].name; 

        if (total_participants > newRoomCapacity) {
            await transaction.rollback();
            return res.status(400).json({ success: false, message: `New total participants exceed room capacity of ${newRoomCapacity}.` });
        }

        const bookingStartUtc = new Date(start_datetime);
        const bookingEndUtc = new Date(end_datetime);

        const newAvailabilityCheck = await request
          .input('checkRoomId', sql.Int, parseInt(room_id)) 
          .input('checkStartDatetime', sql.DateTime, bookingStartUtc) 
          .input('checkEndDatetime', sql.DateTime, bookingEndUtc)     
          .input('currentEventId', sql.NVarChar, eventId) 
          .query(`
            SELECT COUNT(*) AS count FROM room_bookings
            WHERE room_id = @checkRoomId AND status = 'confirmed'
            AND event_id != @currentEventId
            AND (start_datetime < @checkEndDatetime AND end_datetime > @checkStartDatetime);
          `);

        if (newAvailabilityCheck.recordset[0].count > 0) {
            await transaction.rollback();
            return res.status(409).json({ success: false, message: 'The room is already booked for the new time slot (conflict detected).' });
        }

        const updateResult = await request
          .input('updEventId', sql.NVarChar, eventId)
          .input('updRoomId', sql.Int, parseInt(room_id)) 
          .input('updRoomName', sql.NVarChar, newRoomName) 
          .input('updSubject', sql.NVarChar, subject)
          .input('updDescription', sql.NVarChar, description || null)
          .input('updOrganizerEmail', sql.NVarChar, organizer_email)
          .input('updStartDatetime', sql.DateTime, bookingStartUtc) 
          .input('updEndDatetime', sql.DateTime, bookingEndUtc)     
          .input('updTotalParticipants', sql.Int, total_participants)
          .input('updInternalParticipants', sql.Int, internal_participants || null)
          .input('updExternalParticipants', sql.Int, external_participants || null)
          .input('updMeetingType', sql.NVarChar, meeting_type || 'in-person')
          .input('attendee_emails', sql.NVarChar, attendee_emails || '[]')
          .query(`
            UPDATE room_bookings SET
              room_id = @updRoomId,
              room_name = @updRoomName,
              subject = @updSubject,
              description = @updDescription,
              organizer_email = @updOrganizerEmail,
              start_datetime = @updStartDatetime,
              end_datetime = @updEndDatetime,
              total_participants = @updTotalParticipants,
              internal_participants = @updInternalParticipants,
              external_participants = @updExternalParticipants,
              meeting_type = @updMeetingType,
              attendee_emails = @attendee_emails,
              updated_at = GETUTCDATE()
            WHERE event_id = @updEventId;
          `);

        if (updateResult.rowsAffected[0] === 0) {
            await transaction.rollback();
            return res.status(404).json({ success: false, message: 'Booking to update not found.' });
        }

        await transaction.commit(); 

        const confirmationSubject = `Booking Rescheduled: ${subject} at ${newRoomName}`;
        const confirmationHtml = `
          <p>Dear ${organizer_email.split('@')[0]},</p>
          <p>Your room booking has been successfully rescheduled!</p>
          <p><strong>Updated Booking Details:</strong></p>
          <ul>
            <li><strong>Room:</strong> ${newRoomName}</li>
            <li><strong>Subject:</strong> ${subject}</li>
            <li><strong>New Time:</strong> ${new Date(start_datetime).toLocaleString()} - ${new Date(end_datetime).toLocaleString()}</li>
            <li><strong>Total Participants:</strong> ${total_participants}</li>
          </ul>
          <p>Thank you!</p>
        `;
        await sendEmail(organizer_email, confirmationSubject, confirmationHtml);

        res.status(200).json({ success: true, message: 'Booking updated successfully!' });

    } catch (error) {
        if (transaction && transaction.rolledBack === false) {
            try {
                await transaction.rollback();
            } catch (rollbackError) {
                    console.error('Error during transaction rollback for updateBooking:', rollbackError);
            }
        }
        console.error('Error updating booking:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to update booking.',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
  },

  cancelBooking: async (req, res) => {
    const { eventId } = req.params; 
    const { organizerEmail } = req.body; 

    if (!eventId || !organizerEmail) {
        return res.status(400).json({ success: false, message: 'Event ID and organizer email are required for cancellation.' });
    }

    let transaction;
    try {
        if (!bookingController.dbPool) {
            return res.status(500).json({ message: 'Database connection not available' });
        }

        transaction = new sql.Transaction(bookingController.dbPool);
        await transaction.begin();
        const request = new sql.Request(transaction);

        const bookingResult = await request
            .input('eventId', sql.NVarChar, eventId)
            .input('organizerEmail', sql.NVarChar, organizerEmail)
            .query(`
                SELECT subject, room_name, start_datetime, end_datetime, organizer_email
                FROM room_bookings
                WHERE event_id = @eventId AND organizer_email = @organizerEmail AND status = 'confirmed';
            `);

        const bookingToCancel = bookingResult.recordset[0];

        if (!bookingToCancel) {
            await transaction.rollback();
            return res.status(404).json({ success: false, message: 'Booking not found or not eligible for cancellation by this email.' });
        }

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

        await transaction.commit(); 

        const cancellationSubject = `Your Room Booking for "${bookingToCancel.subject}" Has Been Cancelled`;
        const cancellationHtml = `
            <p>Dear ${bookingToCancel.organizer_email.split('@')[0]},</p>
            <p>Your booking for the room <strong>${bookingToCancel.room_name}</strong></p>
            <p>scheduled from <strong>${new Date(bookingToCancel.start_datetime).toLocaleString()}</strong> to <strong>${new Date(bookingToCancel.end_datetime).toLocaleString()}</strong>
            has been successfully cancelled.</p>
            <p>Thank you!</p>
        `;
        await sendEmail(bookingToCancel.organizer_email, cancellationSubject, cancellationHtml);

        res.status(200).json({ success: true, message: 'Booking cancelled successfully.' });

    } catch (error) {
        if (transaction && transaction.rolledBack === false) {
            try {
                await transaction.rollback();
            } catch (rollbackError) {
                console.error('Error during transaction rollback for cancelBooking:', rollbackError);
            }
        }
        console.error('Error cancelling booking:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to cancel the booking due to a server error.',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
  },
};

module.exports = { bookingController };