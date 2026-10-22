// PM2 — Gift Valy STAGING (FUNNEL_LINER.md GV-14): the same app, its own
// release folder, .env (database giftvaly_staging), uploads, invoices and
// port. Nginx sends only gv-staging.funnelliner.com here
// (deploy/nginx/giftvaly-staging.conf). Stop it when nobody is testing, to
// give the RAM back:
//
//   pm2 stop giftvaly-staging && pm2 save        pm2 start giftvaly-staging && pm2 save
//
// Deployed by `scripts/deploy.sh --staging <ref>`; /srv/giftvaly-staging/app is
// a symlink to its current release, its .env a link to /srv/giftvaly-staging/shared/.env.

module.exports = {
  apps: [
    {
      name: "giftvaly-staging",
      cwd: "/srv/giftvaly-staging/app",
      script: "node_modules/next/dist/bin/next",
      // localhost, not 127.0.0.1 — same reason as production (ecosystem.config.cjs).
      args: "start --hostname localhost --port 3210",
      exec_mode: "fork",
      instances: 1,
      env: {
        NODE_ENV: "production",
        TZ: "Asia/Dhaka",
      },
      // Smaller than production's: staging must never starve the real apps.
      max_memory_restart: "700M",
      kill_timeout: 15000,
      listen_timeout: 30000,
      out_file: "/var/log/giftvaly/staging.log",
      error_file: "/var/log/giftvaly/staging-error.log",
      merge_logs: true,
      time: true,
    },
  ],
};
