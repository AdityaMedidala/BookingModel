const sql = require('mssql');
const path = require('path');
const fs = require('fs');

const roomController = {
  dbPool: null, // This will be set by server.js

  // New: Method to inject the database connection pool
  setDbPool: (pool) => {
    roomController.dbPool = pool;
  },

  // GET all rooms
  getAllRooms: async (req, res) => {
    try {
      if (!roomController.dbPool) {
        return res.status(500).json({ message: 'Database connection not available' });
      }
      const result = await roomController.dbPool.request().query('SELECT * FROM rooms ORDER BY name ASC');
      const rooms = result.recordset.map(room => ({
        ...room,
        features: room.features ? room.features.split(',').map(f => f.trim()) : [],
        image: room.image ? `${req.protocol}://${req.get('host')}${room.image}` : null
      }));
      res.status(200).json(rooms);
    } catch (error) {
      console.error('Error fetching rooms:', error);
      res.status(500).json({ message: 'Failed to fetch rooms.' });
    }
  },

  // POST a new room
  createRoom: async (req, res) => {
    const { name, capacity, features } = req.body;
    const imagePath = req.file ? `/uploads/${req.file.filename}` : null;

    if (!name || !capacity) {
      if (req.file) {
        fs.unlink(req.file.path, (err) => {
          if (err) console.error('Error deleting uploaded file on validation fail:', err);
        });
      }
      return res.status(400).json({ message: 'Room name and capacity are required.' });
    }

    try {
      if (!roomController.dbPool) {
        return res.status(500).json({ message: 'Database connection not available' });
      }

      const result = await roomController.dbPool.request()
        .input('name', sql.NVarChar, name)
        .input('capacity', sql.Int, parseInt(capacity)) 
        .input('features', sql.NVarChar, features || null)
        .input('image', sql.NVarChar, imagePath)
        .query('INSERT INTO rooms (name, capacity, features, image) VALUES (@name, @capacity, @features, @image); SELECT SCOPE_IDENTITY() AS id;'); 

      const newRoomId = result.recordset[0].id;
      res.status(201).json({ message: 'Room created successfully.', roomId: newRoomId, imagePath: imagePath });
    } catch (error) {
      console.error('Error creating room:', error);
      if (req.file) {
        fs.unlink(req.file.path, (err) => {
            if (err) console.error('Error deleting newly uploaded file on DB error:', err);
        });
      }
      res.status(500).json({ message: 'Failed to create room.', error: error.message });
    }
  },

  // PUT (update) a room
  updateRoom: async (req, res) => {
    const { id } = req.params;
    const { name, capacity, features } = req.body;
    let imagePath = req.file ? `/uploads/${req.file.filename}` : null; 

    if (!name || !capacity) {
      if (req.file) {
        fs.unlink(req.file.path, (err) => {
          if (err) console.error('Error deleting uploaded file on validation fail:', err);
        });
      }
      return res.status(400).json({ message: 'Room name and capacity are required for update.' });
    }

    let transaction;
    try {
      if (!roomController.dbPool) {
        return res.status(500).json({ message: 'Database connection not available' });
      }

      transaction = new sql.Transaction(roomController.dbPool);
      await transaction.begin();
      const request = new sql.Request(transaction);

      request.input('id', sql.Int, parseInt(id)); 

      const oldRoomResult = await request
        .query('SELECT image FROM rooms WHERE id = @id');
      
      const existingRoom = oldRoomResult.recordset[0];

      if (!existingRoom) {
        await transaction.rollback();
        return res.status(404).json({ message: 'Room not found for update.' });
      }

      const oldImagePath = existingRoom.image;

      if (!imagePath) { 
          imagePath = oldImagePath;
      }

      const finalImagePath = imagePath || null; 

      // Removed 'updated_at = GETDATE()' from the UPDATE query
      const result = await request
        .input('name', sql.NVarChar, name)
        .input('capacity', sql.Int, parseInt(capacity)) 
        .input('features', sql.NVarChar, features || null)
        .input('image', sql.NVarChar, finalImagePath) 
        .query('UPDATE rooms SET name = @name, capacity = @capacity, features = @features, image = @image WHERE id = @id;');
      
      if (result.rowsAffected[0] === 0) {
        await transaction.rollback();
        return res.status(404).json({ message: 'Room not found or no changes made.' });
      }

      await transaction.commit();

      if (req.file && oldImagePath && oldImagePath.startsWith('/uploads/')) {
        const fullOldImagePath = path.join(__dirname, '..', 'public', oldImagePath);
        fs.unlink(fullOldImagePath, (err) => {
          if (err) console.error('Error deleting old room image file:', err);
        });
      }

      res.status(200).json({ message: 'Room updated successfully.', imagePath: finalImagePath });
    } catch (error) {
      if (transaction && transaction.rolledBack === false) {
          try {
              await transaction.rollback();
          } catch (rollbackError) {
              console.error('Error during transaction rollback for updateRoom:', rollbackError);
          }
      }
      if (req.file) {
          fs.unlink(req.file.path, (err) => {
              if (err) console.error('Error deleting newly uploaded file on DB error:', err);
          });
      }
      console.error('❌ Error updating room:', error); 
      res.status(500).json({ message: 'Failed to update room.', error: error.message, details: process.env.NODE_ENV === 'development' ? error : undefined }); 
    }
  },

  // DELETE a room
  deleteRoom: async (req, res) => {
    const { id } = req.params;
    try {
      if (!roomController.dbPool) {
        return res.status(500).json({ message: 'Database connection not available' });
      }

      const roomResult = await roomController.dbPool.request()
        .input('id', sql.Int, parseInt(id)) 
        .query('SELECT image FROM rooms WHERE id = @id');
      
      const roomToDelete = roomResult.recordset[0];

      if (!roomToDelete) {
        return res.status(404).json({ message: 'Room not found.' });
      }

      const result = await roomController.dbPool.request()
        .input('id', sql.Int, parseInt(id)) 
        .query('DELETE FROM rooms WHERE id = @id');
      
      if (result.rowsAffected[0] === 0) {
        return res.status(404).json({ message: 'Room not found for deletion or no rows affected.' });
      }

      if (roomToDelete && roomToDelete.image && roomToDelete.image.startsWith('/uploads/')) {
        const imageFullPath = path.join(__dirname, '..', 'public', roomToDelete.image);
        fs.unlink(imageFullPath, (err) => {
          if (err) console.error('Error deleting room image file:', err);
        });
      }

      res.status(200).json({ message: 'Room deleted successfully.' });
    } catch (error) {
      console.error('Error deleting room:', error);
      res.status(500).json({ message: 'Failed to delete room.', error: error.message });
    }
  },
};

module.exports = { roomController };
