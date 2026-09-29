# vanessa

## Run locally

Run `npm start`, then open <http://localhost:3000> in each browser. Keep the server running and use the same server address in every browser; changes are saved centrally and synchronized to other open browsers.

Dashboard data is stored in `data/dashboard-state.json` by default. Back up this file to preserve or move your data.

## Deploy on Render

This repository includes a Render Blueprint (`render.yaml`) that runs the Node server and mounts a persistent disk for dashboard data. GitHub Pages cannot host this app because it does not run the `/api/state` server.

1. Push this repository to GitHub.
2. In Render, choose **New +** > **Blueprint**, connect this repository, and select `render.yaml`.
3. When prompted, set `DASHBOARD_USERNAME` and `DASHBOARD_PASSWORD` to credentials you choose. Use a long, unique password. Production refuses requests until both are configured.
4. Deploy, then open the Render URL and sign in when prompted by the browser.
5. Test persistence by changing a value, refreshing, then checking again after a redeploy.

### Move existing dashboard data

Before switching to the deployed app, open the current dashboard, go to **Settings**, and choose **Download backup**. After the Render service is deployed, open its URL, sign in, go to **Settings**, choose **Restore backup**, and select the downloaded JSON file. Confirm the restore prompt, then refresh and verify your students and classes are present. Keep the backup file somewhere private; it contains your dashboard data.

The Blueprint configures a 1 GB persistent disk at `/var/data`; Render requires a paid web-service plan for persistent disks. Keep the service to one instance because live updates and file writes are local to that server. Keep the credentials private and back up `/var/data/dashboard-state.json` periodically. If you previously deployed without persistent storage, its old data may not be recoverable after that instance was replaced.

You can change the storage location by setting `DASHBOARD_STATE_FILE` to a path on a persistent disk.