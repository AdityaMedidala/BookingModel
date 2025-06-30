// createAdmin.js
const bcrypt = require('bcrypt');
const sql = require('mssql');
const dotenv = require('dotenv');

dotenv.config();

const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    database: process.env.DB_NAME,
    options: {
        encrypt: process.env.DB_ENCRYPT === 'true',
        trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true'
    }
};

const ADMIN_EMAIL_FOR_TESTING = 'djaditya200@gmail.com';
const ADMIN_PASSWORD_FOR_TESTING = '123';
const ADMIN_ROLE = 'admin';

async function createOrUpdateTestAdminUser() {
    console.log('--- Checking DB Config from .env ---');
    console.log('DB_USER:', process.env.DB_USER);
    console.log('DB_PASSWORD:', process.env.DB_PASSWORD ? '********' : 'undefined');
    console.log('DB_SERVER:', process.env.DB_SERVER);
    console.log('DB_NAME (as database):', process.env.DB_NAME);
    console.log('DB_ENCRYPT:', process.env.DB_ENCRYPT);
    console.log('DB_TRUST_SERVER_CERTIFICATE:', process.env.DB_TRUST_SERVER_CERTIFICATE);
    console.log('--- End DB Config Check ---');

    if (!dbConfig.user || !dbConfig.password || !dbConfig.server || !dbConfig.database) {
        console.error("❌ Database connection details are missing. Please check DB_USER, DB_PASSWORD, DB_SERVER, DB_NAME in your .env file.");
        return;
    }

    let pool;
    try {
        console.log(`Attempting to hash password for ${ADMIN_EMAIL_FOR_TESTING}...`);
        const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD_FOR_TESTING, 10);
        console.log('Password hashed.');

        pool = await sql.connect(dbConfig);
        console.log('Database connected.');

        // --- NEW DIAGNOSTIC STEP: Confirm current database name and ID ---
        const currentDbResult = await pool.request().query("SELECT DB_NAME() AS CurrentDatabaseName, DB_ID() AS CurrentDatabaseId;");
        console.log(`Current Database Name (from app): ${currentDbResult.recordset[0].CurrentDatabaseName}`);
        console.log(`Current Database ID (from app): ${currentDbResult.recordset[0].CurrentDatabaseId}`);
        // --- END NEW DIAGNOSTIC STEP ---

        console.log('--- Listing tables in the connected database ---');
        const tablesResult = await pool.request().query(
            "SELECT TABLE_SCHEMA, TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_SCHEMA, TABLE_NAME;"
        );
        if (tablesResult.recordset.length > 0) {
            tablesResult.recordset.forEach(table => {
                console.log(`  ${table.TABLE_SCHEMA}.${table.TABLE_NAME}`);
            });
        } else {
            console.log('  No tables found in this database schema.');
        }
        console.log('--- End Table List ---');

        const checkUser = await pool.request()
            .input('email', sql.NVarChar, ADMIN_EMAIL_FOR_TESTING)
            .query('SELECT id FROM users WHERE email = @email');

        if (checkUser.recordset.length > 0) {
            console.log(`⚠️ Admin user with email ${ADMIN_EMAIL_FOR_TESTING} already exists. Updating password and role.`);
            await pool.request()
                .input('email', sql.NVarChar, ADMIN_EMAIL_FOR_TESTING)
                .input('passwordHash', sql.NVarChar, hashedPassword)
                .input('adminRole', sql.NVarChar, ADMIN_ROLE)
                .query(`UPDATE users SET password_hash = @passwordHash, role = @adminRole WHERE email = @email`);
            console.log(`✅ Admin user password and role updated for ${ADMIN_EMAIL_FOR_TESTING}`);
        } else {
            console.log(`Creating new admin user: ${ADMIN_EMAIL_FOR_TESTING}`);
            await pool.request()
                .input('email', sql.NVarChar, ADMIN_EMAIL_FOR_TESTING)
                .input('passwordHash', sql.NVarChar, hashedPassword)
                .input('adminRole', sql.NVarChar, ADMIN_ROLE)
                .query(`INSERT INTO users (email, password_hash, role)
                        VALUES (@email, @passwordHash, @adminRole);`);
            console.log(`✅ Admin user ${ADMIN_EMAIL_FOR_TESTING} created successfully.`);
        }
    } catch (err) {
        console.error('❌ Error creating/updating admin user:', err.message);
    } finally {
        if (pool && pool.connected) {
            await pool.close();
            console.log('Database connection closed.');
        }
    }
}

createOrUpdateTestAdminUser();