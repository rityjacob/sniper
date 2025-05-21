import { commandHandler } from './commands';
// ... existing imports ...

// Add this to your message handling logic
async function handleMessage(message: string) {
    try {
        const response = await commandHandler.handleCommand(message);
        if (response) {
            console.log(response);
            // If you're using a chat platform, send the response back
            // await sendMessage(response);
        }
    } catch (error) {
        console.error('Error handling message:', error);
    }
}

// ... rest of your bot code ... 