/**
 * FreelancerHub — Runtime Configuration
 * ──────────────────────────────────────
 * The backend now runs as a Netlify Function — no separate server needed.
 * API calls always go to /api (same origin), which Netlify routes to the function.
 *
 *   LOCAL DEV  → http://localhost:3000  → Express at /api
 *   NETLIFY    → https://arjunlight.netlify.app → /api → serverless function
 */

(function () {
    const isLocal = (
        location.hostname === 'localhost' ||
        location.hostname === '127.0.0.1' ||
        location.hostname === ''
    );

    // Both local and production use /api — Netlify routes it to the Lambda function
    window.API_BASE = '/api';
    window.SOCKET_URL = isLocal ? '/' : null;  // Socket.IO not available in serverless

    // Legacy aliases
    window.FH_API_BASE = window.API_BASE;
    window.FH_SOCKET_URL = window.SOCKET_URL;

    if (isLocal) {
        console.log('[FreelancerHub] 🟡 LOCAL mode — API:', window.API_BASE);
    } else {
        console.log('[FreelancerHub] 🟢 NETLIFY mode — API:', window.API_BASE, '(serverless function)');
    }
})();
