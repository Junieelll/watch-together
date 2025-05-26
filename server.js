const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  // Add WebSocket transport options
  transports: ['websocket', 'polling'],
  // Increase ping timeout for better connection stability
  pingTimeout: 60000,
  // Add better error handling
  allowEIO3: true
});

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// Configure multer for video uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'video-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 500 * 1024 * 1024 // 500MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /mp4|webm|avi|mov|mkv/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only video files are allowed!'));
    }
  }
});

// Middleware
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));
app.use(express.json());

// Store active rooms
const rooms = new Map();

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/upload', upload.single('video'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No video file uploaded' });
  }
  
  res.json({
    success: true,
    filename: req.file.filename,
    videoUrl: `/uploads/${req.file.filename}`
  });
});

app.get('/room/:roomId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'room.html'));
});

// Socket.io handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join-room', (roomId) => {
    socket.join(roomId);
    
    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        users: new Set(),
        host: socket.id,
        currentTime: 0,
        isPlaying: false,
        videoUrl: '',
        screenSharer: null
      });
    }
    
    const room = rooms.get(roomId);
    room.users.add(socket.id);
    
    socket.emit('room-joined', {
      isHost: room.host === socket.id,
      currentTime: room.currentTime,
      isPlaying: room.isPlaying,
      videoUrl: room.videoUrl,
      userCount: room.users.size,
      screenSharer: room.screenSharer
    });
    
    socket.to(roomId).emit('user-joined', { userCount: room.users.size });
    
    console.log(`User ${socket.id} joined room ${roomId}`);
  });

  socket.on('set-video', (data) => {
    const { roomId, videoUrl } = data;
    const room = rooms.get(roomId);
    
    if (room && room.host === socket.id) {
      room.videoUrl = videoUrl;
      room.screenSharer = null; // Stop screen sharing when setting new video
      socket.to(roomId).emit('video-set', { videoUrl });
      console.log(`Video set in room ${roomId}: ${videoUrl}`);
    }
  });

  socket.on('video-action', (data) => {
    const { roomId, action, currentTime } = data;
    const room = rooms.get(roomId);
    
    if (room && room.host === socket.id) {
      room.currentTime = currentTime || 0;
      room.isPlaying = action === 'play';
      
      socket.to(roomId).emit('sync-video', {
        action,
        currentTime: room.currentTime,
        timestamp: Date.now()
      });
      
      console.log(`Video ${action} in room ${roomId} at ${room.currentTime}s`);
    }
  });

  socket.on('seek-video', (data) => {
    const { roomId, currentTime } = data;
    const room = rooms.get(roomId);
    
    if (room && room.host === socket.id) {
      room.currentTime = currentTime;
      socket.to(roomId).emit('sync-seek', { currentTime });
      console.log(`Video seek in room ${roomId} to ${currentTime}s`);
    }
  });

  socket.on('chat-message', (data) => {
    const { roomId, message, username } = data;
    socket.to(roomId).emit('chat-message', { message, username });
  });

  // WebRTC Screen Sharing Events
  socket.on('start-screen-share', (data) => {
    const { roomId } = data;
    const room = rooms.get(roomId);
    
    if (room && room.host === socket.id) {
      console.log(`User ${socket.id} started screen sharing in room ${roomId}`);
      room.screenSharer = socket.id;
      room.videoUrl = ''; // Clear video URL when screen sharing
      socket.to(roomId).emit('screen-share-started', { sharer: socket.id });
      
      // Notify all users in the room about the screen share
      const users = Array.from(room.users).filter(id => id !== socket.id);
      users.forEach(userId => {
        console.log(`Notifying user ${userId} about screen share`);
        socket.to(userId).emit('request-screen-share', { requester: userId });
      });
    }
  });

  socket.on('get-room-users', (data) => {
    const { roomId } = data;
    const room = rooms.get(roomId);
    
    if (room && room.screenSharer === socket.id) {
      console.log(`Getting users for room ${roomId}`);
      // Send list of users to screen sharer
      const users = Array.from(room.users).filter(id => id !== socket.id);
      socket.emit('room-users', { users });
    }
  });

  socket.on('room-users', (data) => {
    const { users } = data;
    console.log(`Creating peer connections for ${users.length} users`);
    // Create peer connections for each user
    users.forEach(userId => {
      console.log(`Requesting screen share for user ${userId}`);
      socket.emit('request-screen-share', { requester: userId });
    });
  });

  socket.on('request-screen-share', (data) => {
    const { roomId, requester } = data;
    const room = rooms.get(roomId);
    
    if (room && room.screenSharer) {
      console.log(`Requesting screen share from ${room.screenSharer} for ${requester}`);
      socket.to(room.screenSharer).emit('request-screen-share', { requester });
    }
  });

  socket.on('webrtc-offer', (data) => {
    console.log(`Forwarding WebRTC offer from ${socket.id} to ${data.target}`);
    socket.to(data.target).emit('webrtc-offer', {
      offer: data.offer,
      sender: socket.id
    });
  });

  socket.on('webrtc-answer', (data) => {
    console.log(`Forwarding WebRTC answer from ${socket.id} to ${data.target}`);
    socket.to(data.target).emit('webrtc-answer', {
      answer: data.answer,
      sender: socket.id
    });
  });

  socket.on('webrtc-ice-candidate', (data) => {
    console.log(`Forwarding ICE candidate from ${socket.id} to ${data.target}`);
    socket.to(data.target).emit('webrtc-ice-candidate', {
      candidate: data.candidate,
      sender: socket.id
    });
  });

  // Handle errors
  socket.on('error', (error) => {
    console.error('Socket error:', error);
  });

  socket.on('stop-screen-share', (data) => {
    const { roomId } = data;
    const room = rooms.get(roomId);
    
    if (room && room.screenSharer === socket.id) {
      room.screenSharer = null;
      socket.to(roomId).emit('screen-share-stopped');
      console.log(`User ${socket.id} stopped screen sharing in room ${roomId}`);
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    
    // Remove user from all rooms
    rooms.forEach((room, roomId) => {
      if (room.users.has(socket.id)) {
        room.users.delete(socket.id);
        
        // If screen sharer disconnected, stop screen sharing
        if (room.screenSharer === socket.id) {
          console.log(`Screen sharer ${socket.id} disconnected from room ${roomId}`);
          room.screenSharer = null;
          socket.to(roomId).emit('screen-share-stopped');
        }
        
        if (room.users.size === 0) {
          // Delete empty room
          console.log(`Deleting empty room ${roomId}`);
          rooms.delete(roomId);
        } else if (room.host === socket.id) {
          // Transfer host to another user
          room.host = Array.from(room.users)[0];
          console.log(`Transferring host to ${room.host} in room ${roomId}`);
          io.to(roomId).emit('host-changed', { newHost: room.host });
        }
        
        socket.to(roomId).emit('user-left', { userCount: room.users.size });
      }
    });
  });
});

// Error handling for the server
server.on('error', (error) => {
  console.error('Server error:', error);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Visit http://localhost:${PORT} to use the app`);
});