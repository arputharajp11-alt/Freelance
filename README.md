<<<<<<< HEAD
# 🚀 FreelancerHub

A **blockchain-powered freelance marketplace** with smart contract escrow, real-time chat, and email notifications.

## ✨ Features

- 🔐 **JWT Authentication** — Register/login as client or freelancer
- 📋 **Job Marketplace** — Post jobs, browse, filter, and apply with proposals
- 🔒 **Blockchain Escrow** — Smart contract locks funds until work is approved
- 💬 **Real-time Chat** — Socket.IO powered messaging between clients & freelancers
- 🔔 **Notifications** — In-app + email alerts for all key events
- 👤 **User Profiles** — Skills, ratings, earnings, wallet address
- 📊 **Dashboard** — Manage jobs, proposals, and earnings

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js, Express.js |
| Database | SQLite (better-sqlite3) |
| Real-time | Socket.IO |
| Auth | JWT (jsonwebtoken) |
| Blockchain | Solidity, Web3.js, Ganache |
| Email | Nodemailer (Ethereal for dev) |
| Frontend | Vanilla HTML/CSS/JS |

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- npm

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
The `.env` file is pre-configured for development. Edit if needed:
```bash
# .env
PORT=3000
JWT_SECRET=freelancer-hub-secret-key-dev-2024
GANACHE_URL=http://127.0.0.1:7545
CONTRACT_ADDRESS=   # Fill after deploying contract
```

### 3. Seed Demo Data
```bash
npm run seed
```

### 4. Start the Server
```bash
npm start
```

### 5. Open in Browser
```
http://localhost:3000
```

## 🔑 Demo Accounts

| Role | Email | Password |
|------|-------|----------|
| Client | client@demo.com | demo123 |
| Client 2 | client2@demo.com | demo123 |
| Freelancer | freelancer@demo.com | demo123 |
| Developer | dev@demo.com | demo123 |

## ⛓️ Blockchain Setup (Optional)

The app works without blockchain. To enable escrow payments:

### 1. Install & Start Ganache
Download [Ganache](https://trufflesuite.com/ganache/) and start it on port 7545.

### 2. Compile the Smart Contract
```bash
npm run compile
```

### 3. Deploy the Contract
```bash
npm run deploy
```
This automatically updates `CONTRACT_ADDRESS` in your `.env` file.

### 4. Connect MetaMask
- Add Ganache network: `http://127.0.0.1:7545`, Chain ID: `1337`
- Import a Ganache account using its private key
- Set your wallet address in your FreelancerHub profile

## 📧 Email Setup (Optional)

By default, the app uses **Ethereal** (fake SMTP) for development — emails are logged to console with a preview URL.

For real emails, configure Gmail in `.env`:
```bash
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password   # Gmail App Password (not your login password)
EMAIL_FROM=FreelancerHub <your-email@gmail.com>
```

## 📁 Project Structure

```
freelancer-hub/
├── server.js                  # Main entry point
├── .env                       # Environment variables
├── contracts/
│   └── Escrow.sol             # Solidity smart contract
├── build/
│   └── FreelancerEscrow.json  # Compiled contract (generated)
├── data/
│   └── freelancerhub.db       # SQLite database (generated)
├── public/
│   ├── index.html             # Landing page
│   ├── login.html             # Login page
│   ├── register.html          # Registration page
│   ├── jobs.html              # Job listings
│   ├── job-detail.html        # Job detail + proposals
│   ├── post-job.html          # Post a new job
│   ├── dashboard.html         # User dashboard
│   ├── chat.html              # Real-time chat
│   ├── notifications.html     # Notifications
│   ├── profile.html           # User profile
│   ├── css/style.css          # Global styles
│   └── js/app.js              # Shared JS utilities
├── scripts/
│   ├── compile-contract.js    # Compile Solidity contract
│   ├── deploy-contract.js     # Deploy to Ganache
│   └── seed-data.js           # Seed demo data
├── server/
│   ├── config/database.js     # SQLite setup & schema
│   ├── middleware/auth.js     # JWT middleware
│   ├── services/email.js      # Email service
│   ├── socket.js              # Socket.IO handlers
│   └── routes/
│       ├── auth.js            # Auth endpoints
│       ├── jobs.js            # Job endpoints
│       ├── chat.js            # Chat endpoints
│       ├── notifications.js   # Notification endpoints
│       └── blockchain.js      # Blockchain endpoints
└── uploads/                   # File uploads directory
```

## 🔌 API Endpoints

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Register new user |
| POST | `/api/auth/login` | Login |
| POST | `/api/auth/logout` | Logout |
| GET | `/api/auth/me` | Get current user |
| PUT | `/api/auth/profile` | Update profile |
| GET | `/api/auth/verify/:token` | Verify email |
| GET | `/api/auth/users/:id` | Get user profile |

### Jobs
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/jobs` | List jobs (with filters) |
| POST | `/api/jobs` | Create job (client only) |
| GET | `/api/jobs/:id` | Get job details |
| GET | `/api/jobs/my/posted` | My posted jobs |
| GET | `/api/jobs/my/applied` | My applied jobs |
| POST | `/api/jobs/:id/apply` | Apply to job (freelancer) |
| POST | `/api/jobs/:id/hire/:fId` | Hire freelancer (client) |
| POST | `/api/jobs/:id/submit` | Submit work (freelancer) |
| POST | `/api/jobs/:id/complete` | Approve & pay (client) |
| POST | `/api/jobs/:id/dispute` | Raise dispute (client) |

### Chat
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/chat/conversations` | List conversations |
| GET | `/api/chat/messages/:id` | Get messages |
| POST | `/api/chat/messages` | Send message |
| GET | `/api/chat/unread` | Unread count |

### Notifications
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/notifications` | List notifications |
| PUT | `/api/notifications/read-all` | Mark all read |
| PUT | `/api/notifications/:id/read` | Mark one read |

### Blockchain
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/blockchain/contract` | Get contract ABI |
| GET | `/api/blockchain/status` | Blockchain status |

## 📜 npm Scripts

```bash
npm start          # Start the server
npm run seed       # Seed demo data
npm run compile    # Compile Solidity contract
npm run deploy     # Deploy contract to Ganache
npm run setup      # Install + compile contract
```

## 🔒 Smart Contract

The `FreelancerEscrow` contract handles:
- **createProject** — Client locks ETH in escrow
- **acceptProject** — Freelancer accepts the project
- **submitWork** — Freelancer marks work as done
- **releaseFunds** — Client approves, ETH sent to freelancer (minus 2.5% fee)
- **raiseDispute** — Client disputes the work
- **resolveDispute** — Platform owner resolves disputes
- **cancelProject** — Client cancels before freelancer accepts

## 📝 License

MIT
=======
# Freelance
>>>>>>> 2b8e54901789c1968596b2dc852ce07e583672d8
