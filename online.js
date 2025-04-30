const onlineUsers = {};

function setupOnlineTracking(io) {
    io.on('connection', socket => {
        console.log('User connected');

        socket.on('register', ({ username }) => {
            socket.username = username;
            onlineUsers[username] = socket.id;
            console.log(`✅ ${username} is now online`);
            socket.broadcast.emit('userOnline', username);
        });

        socket.on('manualDisconnect', () => {
            disconnectUser(socket);
        });

        socket.on('disconnect', () => {
            disconnectUser(socket);
        });

        socket.on('checkOnlineStatus', (username) => {
            if (onlineUsers[username]) {
                socket.emit('userIsOnline', username);
            } else {
                socket.emit('userIsOffline', username);
            }
        });
    });
}

function disconnectUser(socket) {
    if (socket.username && onlineUsers[socket.username]) {
        delete onlineUsers[socket.username];
        const lastSeenTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        socket.broadcast.emit('userOffline', { username: socket.username, lastSeen: lastSeenTime });
        console.log(`❌ ${socket.username} disconnected`);
    }
}

module.exports = setupOnlineTracking;
