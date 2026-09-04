# Trading Backend

This is the backend service for the Trading Journey application, built with Node.js, Fastify, and TypeScript.

## Installation

1. Make sure you are in the `backend` directory:
   ```bash
   cd backend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

## Environment Variables

Copy the example environment file and configure it:

```bash
cp .env.example .env
```

Available variables:
- `PORT` (default: 4000): The port the server will run on.
- `NODE_ENV` (default: development): Environment mode (`development` or `production`).
- `FRONTEND_URL` (default: http://localhost:3000): The URL of the Next.js frontend (used for CORS).

## Development

Start the development server with live reload:

```bash
npm run dev
```

The server will be running on `http://localhost:4000` (or your configured port).

## Production

Build the project:

```bash
npm run build
```

Start the production server:

```bash
npm start
```

## API Endpoints

### Health Check

```http
GET /health
```

Response:
```json
{
  "status": "ok",
  "service": "trading-backend",
  "timestamp": "2026-09-04T10:49:41.000Z"
}
```

## Architecture

This backend is designed to be the central server for:
- Market data provider integration
- Centralized market price service
- WebSocket streaming to the frontend
- Paper trading engine
- Order execution
- SL/TP engine
- Pending order engine
- Account/equity engine
- Supabase persistence
