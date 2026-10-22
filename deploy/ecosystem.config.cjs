// PM2 — Gift Valy production (FUNNEL_LINER.md GV-14) on the Antu Boutique
// server, next to Antu (:3000) and the Funnel Liner admin panel (:3300).
// Nobody reaches it directly: people come through dashboard.funnelliner.com
// (the Antu repo's Nginx block routes the "giftvaly" shop here), machines
// through dashboard.funnelliner.com/_c/giftvaly/, and cron and the admin
// panel on the server itself call http://127.0.0.1:3200.
//
// /srv/giftvaly/app is a symlink to the current release (scripts/deploy.sh);
// the app reads /srv/giftvaly/app/.env, itself a link to /srv/giftvaly/shared/.env.
//
//   pm2 startOrReload /srv/giftvaly/app/deploy/ecosystem.config.cjs --update-env && pm2 save

module.exports = {
  apps: [
    {
      name: "giftvaly",
      cwd: "/srv/giftvaly/app",
      script: "node_modules/next/dist/bin/next",
      // Loopback only. "localhost", never "127.0.0.1": Next renames a loopback
      // host to "localhost" in the proxy's URLs, and a rewrite whose origin
      // differs from the one Next listens on is proxied as an external URL
      // (Antu's CLAUDE.md "Stack gotchas"). On Ubuntu, localhost is 127.0.0.1.
      args: "start --hostname localhost --port 3200",
      // One process: ~15 staff don't need more, and the platform state cache
      // (lib/platform) lives in this process's memory.
      exec_mode: "fork",
      instances: 1,
      env: {
        NODE_ENV: "production",
        TZ: "Asia/Dhaka",
      },
      max_memory_restart: "1000M",
      // Let in-flight requests finish (an invoice PDF render takes a moment).
      kill_timeout: 15000,
      listen_timeout: 30000,
      out_file: "/var/log/giftvaly/app.log",
      error_file: "/var/log/giftvaly/app-error.log",
      merge_logs: true,
      time: true,
    },
  ],
};
