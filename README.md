# Watch Together

A real-time video synchronization and screen sharing application.

## Features

- Watch videos together with friends
- Screen sharing capability
- Real-time chat
- Video synchronization
- Room-based system

## Local Development

1. Install dependencies:
```bash
npm install
```

2. Start the development server:
```bash
npm run dev
```

3. Visit `http://localhost:3000` in your browser

## Deployment

This application is configured for deployment on Render.com:

1. Create a free account on [Render.com](https://render.com)
2. Create a new Web Service
3. Connect your GitHub repository
4. Use the following settings:
   - Environment: Node
   - Build Command: `npm install`
   - Start Command: `node server.js`
   - Plan: Free

The application will be automatically deployed with HTTPS support.

## Requirements

- Node.js >= 14.0.0
- Modern web browser with WebRTC support (Chrome recommended)

## Browser Support

- Chrome (recommended)
- Firefox
- Edge
- Safari (limited WebRTC support)

## Notes

- Screen sharing requires HTTPS in production
- Video uploads are limited to 500MB
- Supported video formats: MP4, WebM, AVI, MOV, MKV 