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
const io = socketio(server);
setupOnlineTracking(io);

// Middlewares
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({ secret: 'sqlitechat', resave: false, saveUninitialized: true }));
app.use(fileUpload());
app.set('view engine', 'ejs');
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

// User DB (JSON based)
const USERS_FILE = path.join(__dirname, 'users.json');
function loadUsers() {
    if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');
    return JSON.parse(fs.readFileSync(USERS_FILE));
}
function saveUser(user) {
    const users = loadUsers();
    users.push(user);
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// Routes
app.get('/', (req, res) => res.redirect('/signup'));
app.get('/signup', (req, res) => res.render('signup'));
app.post('/signup', (req, res) => {
    const { username, email, password } = req.body;
    saveUser({ username, email, password, dp: '/uploads/default.png' });
    res.redirect('/login');
});
app.get('/login', (req, res) => res.render('login'));
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const users = loadUsers();
    const user = users.find(u => u.username === username && u.password === password);
    if (user) {
        req.session.user = user;
        res.redirect('/chat');
    } else {
        res.send('Invalid credentials. <a href="/login">Try Again</a>');
    }
});
app.get('/chat', (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    res.render('chat', {
        username: req.session.user.username,
        user: req.session.user
    });
});
app.get('/chat/:receiver', (req, res) => {
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
});
app.get('/searchUser', (req, res) => {
    const { username } = req.query;
    const users = loadUsers();
    const matched = users.filter(user => user.username.toLowerCase() === username.toLowerCase());
    res.json(matched.map(u => ({
        username: u.username,
        dp: u.dp || '/images/dummy.jpg'
    })));
});
app.get('/upload-dp', (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    res.render('uploadDp', { user: req.session.user });
});
app.post('/uploadDp', (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    const file = req.files.dp;
    const username = req.session.user.username;
    const uploadPath = `public/uploads/${username}_${Date.now()}.jpg`;
    file.mv(uploadPath, err => {
        if (err) {
            console.error('DP Upload Error:', err);
            return res.status(500).send('Upload Error');
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
});
app.post('/uploadSticker', (req, res) => {
    if (!req.session.user) {
        console.log('User not logged in');
        return res.status(401).json({ success: false, error: 'User not logged in' });
    }
    if (!req.files || !req.files.sticker) {
        console.log('No sticker file uploaded');
        return res.status(400).json({ success: false, error: 'No sticker file uploaded' });
    }
    const file = req.files.sticker;
    const username = req.session.user.username;
    const allowedTypes = ['image/gif', 'video/mp4', 'video/webm'];
    if (!allowedTypes.includes(file.mimetype)) {
        console.log('Invalid file type:', file.mimetype);
        return res.status(400).json({ success: false, error: 'Only GIFs or short videos (MP4/WebM) allowed' });
    }
    if (file.size > 10 * 1024 * 1024) {
        console.log('File too large:', file.size);
        return res.status(400).json({ success: false, error: 'File size too large. Max 10MB allowed' });
    }
    const uploadPath = `public/uploads/stickers/${username}_${Date.now()}_${file.name}`;
    console.log('Uploading sticker to:', uploadPath);
    file.mv(uploadPath, err => {
        if (err) {
            console.error('File upload error:', err);
            return res.status(500).json({ success: false, error: 'Upload Error: ' + err.message });
        }
        const stickerUrl = uploadPath.replace('public', '');
        const stickerId = db.insertSticker(stickerUrl, username);
        io.emit('newSticker', { id: stickerId, url: stickerUrl, uploader: username });
        res.json({ success: true, url: stickerUrl });
    });
});
app.get('/getStickers', (req, res) => {
    try {
        const stickers = db.fetchAllStickers();
        res.json(stickers);
    } catch (err) {
        console.error('Error fetching stickers:', err);
        res.status(500).json({ error: 'Error fetching stickers' });
    }
});

// SOCKET.IO
io.on('connection', socket => {
    console.log('✅ Socket Connected');

    socket.on('register', ({ username }) => {
        socket.join(username);
    });

    socket.on('joinChat', ({ sender, receiver }) => {
        socket.join(sender);
        socket.join(receiver);
        db.markMessagesAsSeen(receiver, sender);
        db.fetchConversation(sender, receiver, (messages) => {
            socket.emit('loadOldMessages', messages);
        });
        io.to(sender).emit('seenUpdate', { sender: receiver, receiver: sender });
    });

    socket.on('chatMessage', ({ sender, receiver, message, replyTo }) => {
        const messageId = db.insertMessage(sender, receiver, message, 'text', replyTo);
        io.to(receiver).emit('newMessage', { _id: messageId, sender, receiver, message, type: 'text', time: getCurrentTime(), replyTo });
        socket.emit('messageSent', { _id: messageId });
    });

    socket.on('sendImage', ({ sender, receiver, imageData, replyTo }) => {
        const messageId = db.insertMessage(sender, receiver, imageData, 'image', replyTo);
        io.to(receiver).emit('newMessage', { _id: messageId, sender, receiver, message: imageData, type: 'image', time: getCurrentTime(), replyTo });
        socket.emit('messageSent', { _id: messageId });
    });

    socket.on('sendSticker', ({ sender, receiver, stickerUrl, replyTo }) => {
        const messageId = db.insertMessage(sender, receiver, stickerUrl, 'sticker', replyTo);
        io.to(receiver).emit('newMessage', { _id: messageId, sender, receiver, message: stickerUrl, type: 'sticker', time: getCurrentTime(), replyTo });
        socket.emit('messageSent', { _id: messageId });
    });

    socket.on('editMessage', ({ messageId, newContent }) => {
        db.updateMessageById(messageId, newContent);
        io.emit('messageEdited', { messageId, newContent });
    });

    socket.on('deleteMessage', ({ messageId }) => {
        db.deleteMessageById(messageId);
        io.emit('messageDeleted', { messageId });
    });

    socket.on('seen', ({ sender, receiver }) => {
        db.markMessagesAsSeen(receiver, sender);
        io.to(sender).emit('seenUpdate', { seenSender: receiver, seenReceiver: sender });
    });

    socket.on('disconnect', () => {
        console.log('❌ Socket Disconnected');
    });
});

function getCurrentTime() {
    const now = new Date();
    return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));