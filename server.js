const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const os = require('os');

// Get local network IP automatically
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}
const LOCAL_IP = getLocalIP();

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' },
  maxHttpBufferSize: 50 * 1024 * 1024,
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/receive', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'receive.html'));
});

// Expose server IP to frontend
app.get('/api/host', (req, res) => {
  res.json({ ip: LOCAL_IP, port: PORT });
});

// In-memory session store — no disk storage
const sessions = new Map();
const waitingReceivers = new Map();
const senderSessions = new Map();

const TOKEN_TTL_MS = 10 * 60 * 1000;

function cleanupExpired() {
  const now = Date.now();
  for (const [token, session] of sessions.entries()) {
    if (session.expiresAt < now || session.used) {
      if (session.senderId) {
        io.to(session.senderId).emit('session:expired', { token });
      }
      sessions.delete(token);
      waitingReceivers.delete(token);
    }
  }
}
setInterval(cleanupExpired, 30_000);

io.on('connection', (socket) => {
  console.log(`[+] Connected: ${socket.id}`);

  socket.on('sender:register', ({ fileName, fileSize, fileType }) => {
    const token = uuidv4().replace(/-/g, '').slice(0, 12).toUpperCase();
    const expiresAt = Date.now() + TOKEN_TTL_MS;

    sessions.set(token, {
      senderId: socket.id,
      fileName, fileSize, fileType,
      expiresAt, used: false,
    });
    senderSessions.set(socket.id, token);

    socket.emit('sender:token', {
      token,
      expiresAt,
      link: `/receive?token=${token}`,
      serverIP: LOCAL_IP,
      port: PORT,
    });

    console.log(`[TOKEN] Created ${token} for "${fileName}" (${fileSize} bytes)`);

    if (waitingReceivers.has(token)) {
      const receiverId = waitingReceivers.get(token);
      io.to(socket.id).emit('sender:receiver_ready', { token });
      io.to(receiverId).emit('receiver:sender_ready', { token, fileName, fileSize, fileType });
    }
  });

  socket.on('sender:chunk', ({ token, chunk, chunkIndex, totalChunks }) => {
    const session = sessions.get(token);
    if (!session || session.senderId !== socket.id) return;
    if (session.used || session.expiresAt < Date.now()) {
      socket.emit('error', { message: 'Session expired or already used.' });
      return;
    }
    const receiverId = waitingReceivers.get(token);
    if (!receiverId) {
      socket.emit('error', { message: 'No receiver connected.' });
      return;
    }
    io.to(receiverId).emit('receiver:chunk', { chunk, chunkIndex, totalChunks });

    if (chunkIndex === totalChunks - 1) {
      session.used = true;
      sessions.delete(token);
      waitingReceivers.delete(token);
      senderSessions.delete(socket.id);
      socket.emit('sender:transfer_complete', { token });
      console.log(`[DONE] Token ${token} transfer complete — session destroyed`);
    }
  });

  socket.on('sender:cancel', ({ token }) => {
    const receiverId = waitingReceivers.get(token);
    if (receiverId) io.to(receiverId).emit('receiver:cancelled');
    sessions.delete(token);
    waitingReceivers.delete(token);
    senderSessions.delete(socket.id);
  });

  socket.on('receiver:join', ({ token }) => {
    const session = sessions.get(token);
    if (!session) {
      socket.emit('receiver:invalid_token', { reason: 'Token not found or expired.' });
      return;
    }
    if (session.used) {
      socket.emit('receiver:invalid_token', { reason: 'This link has already been used.' });
      return;
    }
    if (session.expiresAt < Date.now()) {
      socket.emit('receiver:invalid_token', { reason: 'This link has expired.' });
      sessions.delete(token);
      return;
    }

    waitingReceivers.set(token, socket.id);
    socket.emit('receiver:joined', {
      token,
      fileName: session.fileName,
      fileSize: session.fileSize,
      fileType: session.fileType,
      expiresAt: session.expiresAt,
    });
    io.to(session.senderId).emit('sender:receiver_ready', { token });
    console.log(`[JOIN] Receiver ${socket.id} joined token ${token}`);
  });

  socket.on('receiver:ready', ({ token }) => {
    const session = sessions.get(token);
    if (!session) return;
    io.to(session.senderId).emit('sender:start_transfer', { token });
  });

  socket.on('disconnect', () => {
    console.log(`[-] Disconnected: ${socket.id}`);
    const token = senderSessions.get(socket.id);
    if (token) {
      const receiverId = waitingReceivers.get(token);
      if (receiverId) io.to(receiverId).emit('receiver:cancelled', { reason: 'Sender disconnected.' });
      sessions.delete(token);
      waitingReceivers.delete(token);
      senderSessions.delete(socket.id);
    }
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 QuickSend running at:`);
  console.log(`   Local:   http://localhost:${PORT}`);
  console.log(`   Network: http://${LOCAL_IP}:${PORT}\n`);
});
