// server.js (Corrected and updated for room management)
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const sql = require('mssql');
const path = require('path');
const fs = require('fs');

dotenv.config(); // Load environment variables from .env file

const app = express();
const PORT = process.env.PORT || 5000; // Define server port

// Create upload directory if it doesn't exist
const uploadDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
  console.log(`Created upload directory: ${uploadDir}`);
}

// --- Middleware (Registered First) ---
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:8080', // Keep for development or specific needs
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static files from the 'public' directory (which now contains 'dist')
app.use(express.static(path.join(__dirname, 'public')));

// Serve the built frontend from the 'public/dist' directory
app.use(express.static(path.join(__dirname, 'public', 'dist'))); // This is the new line to serve your frontend

app.use((req, res, next) => {
  console.log(`📍 ${req.method} ${req.path} - ${new Date().toISOString()}`);
  next();
});

// --- SQL Server Configuration ---
const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_NAME,
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true',
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
    enableArithAbort: true,
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000
  }
};

let dbPool;

// --- Asynchronous Server Startup Function ---
const startServer = async () => {
  try {
    console.log('Connecting to database...');
    console.log('DB Configuration:', dbConfig);
    dbPool = await new sql.ConnectionPool(dbConfig).connect();
    console.log('✅ Database connected successfully');

    // 2. Import Controllers AFTER dbPool is established
    const { bookingController } = require('./controllers/bookingController');
    const { roomController } = require('./controllers/roomController');
    const { adminController } = require('./controllers/adminController');
    const { otpController } = require('./controllers/otpController');

    // Inject Database Pool into Controllers
    bookingController.setDbPool(dbPool);
    roomController.setDbPool(dbPool);
    adminController.setDbPool(dbPool);
    otpController.setDbPool(dbPool);

    // 3. Register API Routes
    const bookingRoutes = require('./routes/bookingRoutes');
    const otpRoutes = require('./routes/otpRoutes');
    const adminRoutes = require('./routes/adminRoutes');
    const roomRoutes = require('./routes/roomRoutes');

    app.use('/api/bookings', bookingRoutes);
    app.use('/api/otp', otpRoutes);
    app.use('/api/admin', adminRoutes);
    app.use('/api/rooms', roomRoutes);

    // --- Catch-all to serve frontend's index.html for client-side routing ---
    // This should be after your API routes but before the 404 handler.
    app.get('*', (req, res, next) => { // Added 'next' parameter
        // Check if the request is for an API route
        if (req.originalUrl.startsWith('/api/') || req.originalUrl.startsWith('/uploads/')) { // Added /uploads/
            // Let the 404 handler or specific API route handle it
            return next(); // Pass to the next middleware (which could be the 404)
        }
        // Otherwise, serve the index.html from the built frontend
        res.sendFile(path.join(__dirname, 'public', 'dist', 'index.html'));
    });


    // 4. Register 404 and Global Error Handlers (LAST)
    app.use('*', (req, res) => {
      res.status(404).json({
        error: 'Route not found',
        path: req.originalUrl
      });
    });

    app.use((error, req, res, next) => {
      console.error('❌ Unhandled error:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
      });
    });

    // 5. Start the Server
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });

  } catch (error) {
    console.error('❌ Server startup failed:', error.message);
    process.exit(1);
  }
};

// --- Graceful Shutdown ---
process.on('SIGINT', async () => {
  console.log('SIGINT signal received: Closing database connection...');
  if (dbPool) {
    try {
      await dbPool.close();
      console.log('✅ Database connection closed.');
    } catch (err) {
      console.error('Error closing database connection:', err);
    }
  }
  process.exit(0);
});

// --- Start the application ---
startServer();