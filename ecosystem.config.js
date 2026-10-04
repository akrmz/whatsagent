// PM2 process file. From the repository root:
//   pm2 start ecosystem.config.js --only whatsapp-bot        # the bot
//   pm2 start ecosystem.config.js --only whatsapp-pairing    # the pairing page, only while pairing
// See docs/DEPLOYMENT.md.

module.exports = {
  apps: [
    {
      name: "whatsapp-bot",
      cwd: "./MD-main",
      script: "index.js",
      env: { NODE_ENV: "production", LOG_FORMAT: "json" },
      max_memory_restart: "700M",
      kill_timeout: 15000, // give the bot time to save state and close the socket
      exp_backoff_restart_delay: 2000, // back off if it keeps crashing
      max_restarts: 50,
      time: true,
    },
    {
      name: "whatsapp-pairing",
      cwd: "./Bot_Pair_Code-main",
      script: "index.js",
      env: { NODE_ENV: "production" },
      max_memory_restart: "300M",
      exp_backoff_restart_delay: 2000,
      autorestart: true,
      time: true,
    },
  ],
};
