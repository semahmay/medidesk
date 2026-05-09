# MediDesk AI

AI-powered patient management tool for doctors.

## Features

- **Patient Management**: Complete CRUD operations for patient records
- **AI Chat Integration**: Claude API for intelligent patient assistance
- **Voice Notes**: OpenAI Whisper for voice transcription
- **File Attachments**: Support for photos and PDFs
- **Custom Columns**: Configure patient table fields
- **Multi-language**: English and French support
- **Local Storage**: All data stays on your PC with SQLite

## Tech Stack

- **Frontend**: Electron + React
- **Backend**: Python 3.11 + Flask
- **Database**: SQLite
- **AI Services**: OpenAI Whisper (local), Claude API
- **Communication**: HTTP (localhost:5000)

## Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm run install-deps
   ```

3. Set up environment variables:
   ```bash
   cp backend/.env.example backend/.env
   # Edit backend/.env and add your Claude API key
   ```

## Development

Start the application in development mode:
```bash
npm run dev
```

This will start:
- Flask backend on http://localhost:5000
- React frontend on http://localhost:3000
- Electron desktop app

## Production

Build the desktop application:
```bash
npm run build
```

## Project Structure

```
medidesk-ai/
├── electron/          # Electron main process
├── frontend/          # React frontend
├── backend/           # Flask backend
├── data/             # SQLite database and attachments
└── package.json      # Main project configuration
```

## API Endpoints

- `GET /api/health` - Health check
- `GET/POST /api/setup` - Initial setup
- `GET/POST /api/patients` - Patient CRUD
- `GET/PUT/DELETE /api/patients/:id` - Individual patient operations
- `POST /api/transcribe` - Voice transcription
- `POST /api/chat` - AI chat with Claude

## License

MIT
