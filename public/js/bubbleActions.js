const socket = io(); // Global socket

document.addEventListener('DOMContentLoaded', () => {
    const messagesDiv = document.getElementById('messages');

    messagesDiv.addEventListener('click', (e) => {
        const bubble = e.target.closest('.message');
        if (!bubble) return;

        const isSent = bubble.classList.contains('sent');
        const messageId = bubble.dataset.id;

        if (!messageId) return;

        // Remove existing popups
        const oldPopup = document.getElementById('action-popup');
        if (oldPopup) oldPopup.remove();

        // Create new popup
        const popup = document.createElement('div');
        popup.id = 'action-popup';
        popup.style.position = 'absolute';
        popup.style.background = 'white';
        popup.style.padding = '8px';
        popup.style.boxShadow = '0 2px 10px rgba(0,0,0,0.2)';
        popup.style.borderRadius = '8px';
        popup.style.display = 'flex';
        popup.style.flexDirection = 'column';
        popup.style.gap = '5px';
        popup.style.zIndex = '100';
        popup.style.fontSize = '14px';

        // Positioning popup near click
        popup.style.left = e.pageX + 'px';
        popup.style.top = e.pageY + 'px';

        if (isSent) {
            popup.innerHTML = `
                <button id="editBtn">✏️ Edit</button>
                <button id="deleteBtn">🗑️ Delete</button>
            `;
        }
        popup.innerHTML += `
            <button id="replyBtn">↩️ Reply</button>
        `;

        document.body.appendChild(popup);

        // Edit button
        const editBtn = document.getElementById('editBtn');
        if (editBtn) {
            editBtn.addEventListener('click', () => {
                const oldText = bubble.querySelector('div')?.innerText || '';
                const newText = prompt('Edit your message:', oldText);
                if (newText !== null && newText.trim() !== '') {
                    socket.emit('editMessage', { messageId, newText });
                    bubble.querySelector('div').innerText = newText + ' (edited)';
                }
                popup.remove();
            });
        }

        // Delete button
        const deleteBtn = document.getElementById('deleteBtn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => {
                if (confirm('Are you sure you want to delete this message?')) {
                    socket.emit('deleteMessage', { messageId });
                    bubble.remove();
                }
                popup.remove();
            });
        }

        // Reply button
        const replyBtn = document.getElementById('replyBtn');
        if (replyBtn) {
            replyBtn.addEventListener('click', () => {
                const originalText = bubble.querySelector('div')?.innerText || '';
                const replyBox = document.getElementById('replyBox');
                if (replyBox) replyBox.remove();

                const newReply = document.createElement('div');
                newReply.id = 'replyBox';
                newReply.style.background = '#e0e0e0';
                newReply.style.padding = '6px';
                newReply.style.marginBottom = '5px';
                newReply.style.borderRadius = '6px';
                newReply.style.fontSize = '13px';
                newReply.innerHTML = `Replying to: <b>${originalText}</b>`;

                const inputArea = document.querySelector('.message-input');
                inputArea.insertBefore(newReply, inputArea.firstChild);

                window.replyingToId = messageId;
                window.replyingToText = originalText;

                popup.remove();
            });
        }

    });

    // Remove popup if clicked outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#action-popup') && !e.target.closest('.message')) {
            const oldPopup = document.getElementById('action-popup');
            if (oldPopup) oldPopup.remove();
        }
    });

});

// Emit edited and deleted messages to server
socket.on('messageEdited', ({ messageId, newText }) => {
    const bubble = document.querySelector(`.message[data-id="${messageId}"]`);
    if (bubble) {
        bubble.querySelector('div').innerText = newText + ' (edited)';
    }
});

// ✅ Real-time delete message in chat_user.ejs
socket.on('messageDeleted', ({ messageId }) => {
    const bubble = document.querySelector(`.message[data-id="${messageId}"]`);
    if (bubble) {
      bubble.remove();
    }
  });
  
