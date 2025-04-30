const express = require('express');
const session = require('express-session');
const fileUpload = require('express-fileupload');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const http = require('http');
const socketio = require('socket.io');
const db = require('./db');
const setupOnlineTracking = require('./online');

const app = express();
const server = http.createServer(app);
const io = socketio(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  transports: ['websocket'] // Force WebSocket to avoid polling issues
});
setupOnlineTracking(io);

// Create directories if they don't exist
try {
  const uploadsDir = path.join(__dirname, 'public/uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
    console.log('Created uploads directory');
  }

  const dbDir = path.join(__dirname, 'chat.db');
  if (!fs.existsSync(path.dirname(dbDir))) {
    fs.mkdirSync(path.dirname(dbDir), { recursive: true });
    console.log('Created database directory');
  }

  const usersFile = path.join(__dirname, 'users.json');
  if (!fs.existsSync(usersFile)) {
    fs.writeFileSync(usersFile, '[]');
    console.log('Created users.json');
  }
} catch (error) {
  console.error('Error creating directories:', error);
}

// Static and Middlewares
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({ 
  secret: 'whatsappclone', 
  resave: false, 
  saveUninitialized: true,
  cookie: { secure: process.env.NODE_ENV === 'production' } // Secure cookies in production
}));
app.use(fileUpload());
app.set('view engine', 'ejs');
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

// Healthcheck endpoint for Railway
app.get('/health', (req, res) => {
  try {
    res.status(200).send('OK');
  } catch (error) {
    console.error('Healthcheck error:', error);
    res.status(500).send('Server error');
  }
});

// User database
const USERS_FILE = path.join(__dirname, 'users.json');

function loadUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE));
  } catch (error) {
    console.error('Error loading users:', error);
    return [];
  }
}

function saveUser(user) {
  try {
    const users = loadUsers();
    users.push(user);
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  } catch (error) {
    console.error('Error saving user:', error);
  }
}

// Routes
app.get('/', (req, res) => res.redirect('/signup'));

app.get('/signup', (req, res) => {
  try {
    res.render('signup');
  } catch (error) {
    console.error('Signup page error:', error);
    res.status(500).send('Error loading signup page');
  }
});

app.post('/signup', (req, res) => {
  try {
    const { username, email, password } = req.body;
    saveUser({ username, email, password, dp: '/uploads/default.png' });
    res.redirect('/login');
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).send('Error signing up. <a href="/signup">Try Again</a>');
  }
});

app.get('/login', (req, res) => {
  try {
    res.render('login');
  } catch (error) {
    console.error('Login page error:', error);
    res.status(500).send('Error loading login page');
  }
});

app.post('/login', (req, res) => {
  try {
    const { username, password } = req.body;
    const users = loadUsers();
    const user = users.find(u => u.username === username && u.password === password);
    if (user) {
      req.session.user = user;
      res.redirect('/chat');
    } else {
      res.send('Invalid credentials. <a href="/login">Try Again</a>');
    }
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).send('Error logging in. <a href="/login">Try Again</a>');
  }
});

app.get('/chat', (req, res) => {
  try {
    if (!req.session.user) return res.redirect('/login');
    res.render('chat', { 
      username: req.session.user.username,
      user: req.session.user
    });
  } catch (error) {
    console.error('Chat page error:', error);
    res.status(500).send('Error loading chat page');
  }
});

app.get('/chat/:receiver', (req, res) => {
  try {
    if (!req.session.user) return res.redirect('/login');
    const receiver = req.params.receiver;
    const users = loadUsers();
    const found = users.find(u => u.username === receiver);

    res.render('chat_user', { 
      sender: req.session.user.username,
      receiver,
      receiverDp: found?.dp || '/images/dummy.jpg',
      user: req.session.user
    });
  } catch (error) {
    console.error('Chat user page error:', error);
    res.status(500).send('Error loading chat');
  }
});

app.get('/searchUser', (req, res) => {
  try {
    const { username } = req.query;
    const users = loadUsers();
    const matched = users.filter(user => user.username.toLowerCase() === username.toLowerCase());
    res.json(matched.map(u => ({
      username: u.username,
      dp: u.dp || '/images/dummy.jpg'
    })));
  } catch (error) {
    console.error('Search user error:', error);
    res.status(500).json([]);
  }
});

app.get('/upload-dp', (req, res) => {
  try {
    if (!req.session.user) return res.redirect('/login');
    res.render('uploadDp', { user: req.session.user });
  } catch (error) {
    console.error('Upload DP page error:', error);
    res.status(500).send('Error loading upload page');
  }
});

app.post('/uploadDp', (req, res) => {
  try {
    if (!req.session.user) return res.redirect('/login');
    const file = req.files.dp;
    const username = req.session.user.username;
    const uploadPath = `public/uploads/${username}_${Date.now()}.jpg`;

    file.mv(uploadPath, err => {
      if (err) {
        console.error('Upload DP error:', err);
        return res.status(500).send('Error uploading file.');
      }
      const users = loadUsers();
      const userIndex = users.findIndex(u => u.username === username);
      if (userIndex !== -1) {
        users[userIndex].dp = uploadPath.replace('public', '');
        fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
        req.session.user.dp = users[userIndex].dp;
      }
      res.redirect('/chat');
    });
  } catch (error) {
    console.error('Upload DP error:', error);
    res.status(500).send('Error uploading file.');
  }
});

// SOCKET.IO EVENTS
io.on('connection', socket => {
  console.log('✅ User connected');

  socket.on('register', ({ username }) => {
    try {
      socket.join(username);
    } catch (error) {
      console.error('Register error:', error);
    }
  });

  socket.on('joinChat', async ({ sender, receiver }) => {
    try {
      socket.join(sender);
      socket.join(receiver);

      await db.markMessagesAsSeen(receiver, sender);
      db.fetchConversation(sender, receiver, (messages) => {
        socket.emit('loadOldMessages', messages);
      });
      io.to(sender).emit('seenUpdate', { sender: receiver, receiver: sender });
    } catch (error) {
      console.error('Join chat error:', error);
    }
  });

  socket.on('chatMessage', async ({ sender, receiver, message, replyTo }) => {
    try {
      const messageId = await db.insertMessage(sender, receiver, message, 'text', replyTo);
      io.to(receiver).emit('newMessage', { _id: messageId, sender, receiver, message, type: 'text', time: getCurrentTime(), replyTo });
      socket.emit('messageSent', { _id: messageId });
    } catch (error) {
      console.error('Chat message error:', error);
    }
  });

  socket.on('sendImage', async ({ sender, receiver, imageData, replyTo }) => {
    try {
      const messageId = await db.insertMessage(sender, receiver, imageData, 'image', replyTo);
      io.to(receiver).emit('newMessage', { _id: messageId, sender, receiver, message: imageData, type: 'image', time: getCurrentTime(), replyTo });
      socket.emit('messageSent', { _id: messageId });
    } catch (error) {
      console.error('Send image error:', error);
    }
  });

  socket.on('editMessage', async ({ messageId, newContent }) => {
    try {
      await db.updateMessageById(messageId, newContent);
      io.emit('messageEdited', { messageId, newContent });
    } catch (error) {
      console.error('Edit message error:', error);
    }
  });

  socket.on('seen', async ({ sender, receiver }) => {
    try {
      await db.markMessagesAsSeen(receiver, sender);
      io.to(sender).emit('seenUpdate', { sender, receiver });
    } catch (error) {
      console.error('Seen update error:', error);
    }
  });

  socket.on('deleteMessage', async ({ messageId }) => {
    try {
      await db.deleteMessageById(messageId);
      io.emit('messageDeleted', { messageId });
    } catch (error) {
      console.error('Delete message error:', error);
    }
  });

  // WebRTC Call Events
  socket.on('call', ({ sender, receiver, type }) => {
    try {
      io.to(receiver).emit('call', { sender, type });
    } catch (error) {
      console.error('Call event error:', error);
    }
  });

  socket.on('acceptCall', ({ sender, receiver }) => {
    try {
      io.to(receiver).emit('acceptCall', { sender });
    } catch (error) {
      console.error('Accept call event error:', error);
    }
  });

  socket.on('signal', ({ sender, receiver, data }) => {
    try {
      io.to(receiver).emit('signal', { sender, data });
    } catch (error) {
      console.error('Signal event error:', error);
    }
  });

  socket.on('endCall', ({ sender, receiver }) => {
    try {
      io.to(receiver).emit('endCall', { sender });
    } catch (error) {
      console.error('End call event error:', error);
    }
  });

  socket.on('disconnect', () => {
    console.log('❌ User disconnected');
  });
});

function getCurrentTime() {
  try {
    const now = new Date();
    return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (error) {
    console.error('Get time error:', error);
    return '';
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server running on http://localhost:${PORT}`));
