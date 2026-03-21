# Photographer Desktop App – School ID Card Automation

Electron + React (JS) desktop application for the **Photographer** role in the School ID Card Automation system.

## Features

- **Splash** → **Login** → **Dashboard**
- **Assigned Schools** → **Classes** → **Student List**
- **Photo capture** (webcam) or **upload from computer**
- **Photo Preview** with Retake / Confirm
- **Bulk Photo Mode** (one-by-one capture, auto next)
- **Correction List** for re-capture / re-upload
- **Delivery Panel** – mark school/class as delivered
- **Notifications** and **Profile**
- **Offline UI** – pending uploads and sync indicator (UI only; backend not included)
- **Status badges**: Pending, Photo Uploaded, Correction Required, Approved, Printed, Delivered

## Tech Stack

- **Electron** – desktop shell
- **React 18** + **React Router 6**
- **Vite** – build and dev server
- **JavaScript** (no TypeScript)

## Run locally

```bash
# Install dependencies
npm install

# Development (Vite dev server + Electron)
npm run electron:dev

# Or run only web app in browser
npm run dev
```

## Build for production

```bash
npm run build
npm run electron
# Or packaged app:
npm run electron:build
```

## Project structure

```
├── electron/
│   └── main.js           # Electron main process
├── src/
│   ├── components/       # Sidebar, Header, StudentTable, CameraView, UploadBox, StatusBadge, Layout, OfflineBanner
│   ├── context/
│   │   └── AppContext.jsx # Auth + mock data (schools, classes, students, notifications)
│   ├── pages/            # Splash, Login, Dashboard, Schools, Classes, Students, Camera, Preview, BulkMode, CorrectionList, Delivery, Notifications, Profile
│   ├── App.jsx
│   ├── main.jsx
│   └── index.css
├── index.html
├── package.json
└── vite.config.js
```

## Mock data

The app uses in-memory mock data (schools, classes, students, notifications). Replace `AppContext` usage with real API calls when connecting to your backend.

## Login

Use any email/mobile and password to login; the app sets a mock user and redirects to Dashboard.
