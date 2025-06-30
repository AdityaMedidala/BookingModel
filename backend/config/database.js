// ================================
// config/database.js - Fixed Database configuration
// ================================
import sql from 'mssql';
import dotenv from 'dotenv';

dotenv.config();

const config = {
  user: process.env.DB_USER || 'aditya',
  password: process.env.DB_PASSWORD || 'Pel@0184',
  server: process.env.DB_SERVER || 'localhost',
  database: process.env.DB_NAME || 'Bookings',
  port: 1433,
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true,
    connectionTimeout: 30000,
    requestTimeout: 30000,
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

let pool;

export const connectDB = async () => {
  try {
    console.log(`🔄 Connecting to database...`);
    console.log(`   Server: ${config.server}`);
    console.log(`   Database: ${config.database}`);
    
    pool = await sql.connect(config);
    console.log(`✅ Connected to MS SQL Server`);
    
    // Test the connection
    const testResult = await pool.request().query('SELECT 1 as test');
    console.log(`✅ Database connection test successful`);
    
    return pool;
    
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    throw error;
  }
};

export const getPool = () => {
  if (!pool) {
    throw new Error('Database not connected. Call connectDB first.');
  }
  return pool;
};

export const closeDB = async () => {
  if (pool) {
    try {
      await pool.close();
      console.log('Database connection closed');
    } catch (error) {
      console.error('Error closing database connection:', error);
    }
  }
};

export { sql };
