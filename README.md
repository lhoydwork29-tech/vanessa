# Teacher Vanessa's Private Class Dashboard

A static, responsive dashboard frontend with per-account cloud persistence through Supabase. GitHub Pages serves the files; Supabase Auth and Postgres store and synchronize dashboard data. The Node server and JSON file are retained only for local development and are not used by the Pages deployment.

## Project files

- `index.html` contains the dashboard interface and application logic.
- `supabase-config.js` contains the public Supabase project URL and anon key.
- `supabase-setup.sql` creates the private state table, row-level security policy, conflict-safe save function, and realtime publication entry.
- `server.js` supports optional local development with `data/dashboard-state.json`.

## Supabase setup

1. Create a project at <https://supabase.com/> and wait for its database to finish provisioning.
2. In the Supabase SQL Editor, paste and run the contents of `supabase-setup.sql`.
3. In **Project Settings > API**, copy the Project URL and the **anon/public** key. Never use the `service_role` key in this frontend.
4. Put those two public values in `supabase-config.js`:

   ```js
   window.DASHBOARD_SUPABASE_CONFIG = {
	   url: 'https://YOUR-PROJECT-REF.supabase.co',
	   anonKey: 'YOUR_PUBLIC_ANON_KEY'
   };
   ```

   The anon key is intended to be visible in browser code. The database RLS policy restricts every row to its authenticated owner. Do not add a service-role key, database password, or other private credential.
5. In **Authentication > URL Configuration**, set the Site URL to your GitHub Pages URL, for example `https://YOUR-GITHUB-USER.github.io/YOUR-REPOSITORY/`. Add that URL to the allowed redirect URLs. Email confirmation can remain enabled; confirm the signup email before signing in.
6. Save and publish `supabase-config.js` with the frontend. Keep the project URL and public anon key together in that file for the published site.

Each account can only read and change its own dashboard row. Anyone can create an account for their own isolated dashboard; do not share your sign-in credentials. Realtime is enabled for the state table by the setup SQL. Concurrent edits from separate browsers are detected and require an explicit reload or overwrite choice rather than silently replacing newer data.

## GitHub Pages deployment

1. Commit and push the project to a GitHub repository after adding the Supabase public configuration.
2. Open the repository's **Settings > Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, select the branch containing the app (usually `main`) and folder **/(root)**, then save.
4. Wait for the Pages deployment to finish. Open the published URL, create your dashboard account, and sign in.
5. In **Supabase > Authentication > URL Configuration**, make sure the exact Pages URL is allowed. Use the HTTPS Pages URL on all devices.

No build command, Node server, or development computer is needed after deployment. The app loads Supabase JS and styling/fonts from public CDNs, so those services and an internet connection are needed.

## Run locally

For the legacy local-only development server, run `npm start` and open <http://localhost:3000>. Its JSON data is separate from the Supabase account data. To test cloud behavior locally, keep `supabase-config.js` populated and use the same Supabase account as the Pages site.

## Backups and migration

Use **Settings > Download backup** to export the currently loaded dashboard state. **Restore backup** replaces the state for the signed-in account after confirmation. Before moving an existing local/Render dataset to Supabase, export a backup from the old dashboard, configure the cloud project, sign in, and restore that backup. The JSON backup contains private student information; store it securely and delete temporary copies when no longer needed.

## Verify cloud sync

1. Sign in to the published dashboard in one browser and add a student.
2. Sign in to the same account in a private window or another device. The student should arrive through the realtime database update; refresh once if the browser has not yet completed its realtime connection.
3. Schedule a class, mark it Present, and confirm it appears in Class Records, Payments, and Reports.
4. Change that student's rate and verify the existing class retains its saved rate snapshot.
5. Mark a payment Paid and confirm the status remains after opening the dashboard elsewhere or signing in again.

## Data and limitations

Supabase stores one JSON state document per authenticated user, including students, classes, settings, and payment statuses. This keeps the existing dashboard features on one synchronized data source and is suitable for a personal dashboard. Realtime sends the updated document to other signed-in clients. Writes use a revision check; when two devices change the document at once, the later save is paused until the user chooses which version to keep. There is no offline write queue, so changes made without a connection are not reported as saved.

The dashboard depends on Supabase availability, configured email authentication, and CDN availability. Supabase free-plan quotas and project pause policies may apply. Keep periodic backups. Existing local JSON data does not automatically migrate; use the export/restore steps above.