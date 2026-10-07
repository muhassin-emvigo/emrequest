# Publishing emRequest

You do the one-time setup steps once. After that, each new version takes about 5 minutes.

> **Important date:** Microsoft is retiring *global* Personal Access Tokens (PATs) on **1 December 2026**. From then on, publishing with `vsce login` plus a PAT stops working. The simplest route that keeps working is **uploading the `.vsix` file on the Marketplace website** (Part B, step 3). That's the main route below.

---

## Part A: Put the code on GitHub (one time)

1. Create a repo, e.g. `github.com/muhassin-emvigo/emrequest` (public for a public extension).
2. Push this folder:
   ```bash
   git init && git add . && git commit -m "emRequest 0.2.0"
   git branch -M main
   git remote add origin https://github.com/muhassin-emvigo/emrequest.git
   git push -u origin main
   ```
3. Add these lines to `package.json` (replace the URL):
   ```json
   "repository": { "type": "git", "url": "https://github.com/muhassin-emvigo/emrequest.git" },
   "bugs": { "url": "https://github.com/muhassin-emvigo/emrequest/issues" },
   "homepage": "https://github.com/muhassin-emvigo/emrequest#readme",
   ```
4. Optional: add a screenshot. Save it as `media/screenshot.png`, commit it, and add `![emRequest](media/screenshot.png)` to the README. This works once the repo link is in place.

## Part B: VS Code Marketplace

### One-time setup
1. Go to **https://marketplace.visualstudio.com/manage** and sign in with the Microsoft account Emvigo will own long-term. Use a shared company account, not a personal one.
2. Click **Create publisher**:
   - **ID**: `emvigo`. This can never be changed, and it must match `"publisher"` in `package.json`. If `emvigo` is taken, pick another (e.g. `emvigotech`) and update `package.json`.
   - **Name**: `Emvigo Technologies` (the display name).

### Each release
1. Increase `"version"` in `package.json` (e.g. 0.2.0 → 0.2.1) and add a line to `CHANGELOG.md`.
2. Build the file:
   ```bash
   npm install
   npm test
   npx vsce package        # makes emrequest-<version>.vsix
   ```
3. On **marketplace.visualstudio.com/manage**, go to your publisher:
   - First time: **New extension → Visual Studio Code**, and upload the `.vsix`.
   - Updates: click **…** next to emRequest → **Update**, and upload the new `.vsix`.
4. Microsoft scans it, usually within a few minutes. Then it's live at
   `https://marketplace.visualstudio.com/items?itemName=emvigo.emrequest`.

*Command-line alternative (only until 1 Dec 2026):* create a PAT in Azure DevOps with **Organization: All accessible organizations** and **Scope: Marketplace → Manage**. Then run `npx vsce login emvigo` and `npx vsce publish`. After that date, automated publishing needs Microsoft Entra ID set up in an Azure pipeline. Ask when you need it.

### Later: the "verified" blue tick
After the publisher has been active for 6 months, open the publisher's **Details** tab and add the domain `emvigotech.com`. Then add the DNS TXT record it shows you. Review takes about 5 business days.

## Part C: Open VSX (Cursor, Windsurf, VSCodium, Gitpod)

### One-time setup
1. Create an Eclipse account at **https://accounts.eclipse.org**. Fill in the **GitHub Username** field with the GitHub account you'll use in step 2.
2. Sign in at **https://open-vsx.org** with that GitHub account. Open your profile, connect the Eclipse account, and **accept the Publisher Agreement**.
3. Open **Settings → Access Tokens** and create a token. Copy it now, because it's shown only once. Store it in the company password manager.
4. Reserve the namespace (it must match `"publisher"`):
   ```bash
   npx ovsx create-namespace emvigo -p <OPEN_VSX_TOKEN>
   ```
5. Optional: claim ownership of the namespace (the verified badge) by following the "claim namespace" process on open-vsx.org.

### Each release
Use the same `.vsix` you built above:
```bash
npx ovsx publish emrequest-<version>.vsix -p <OPEN_VSX_TOKEN>
```
Open VSX runs automatic checks (for secrets, blocked files, name look-alikes). If it rejects the upload, fix the issue and publish again.

### Cursor
Cursor gets its extensions from Open VSX, so once Part C is done emRequest shows up in Cursor's Extensions search. You don't need a separate upload.
- It can take **a few hours** to appear, because Cursor copies from Open VSX on a schedule and runs its own security scan first.
- If it still doesn't appear, check `engines.vscode` in `package.json`. It must not be newer than the VS Code version Cursor is built on (see Cursor → Help → About). Ours is `^1.85.0`, which is safely low.
- **Cursor "verified" badge:** add a page on emvigotech.com that links to the Open VSX listing, set `"homepage"` in `package.json` to that page, then post a request in Cursor's forum category *Extension Verification*.
- To use it before it's listed: in Cursor, open Extensions → `…` → **Install from VSIX…** and pick the `.vsix`.

### Antigravity (Google)
Antigravity also uses Open VSX by default, so Part C covers it too. No separate upload is needed.
- To install from the file: Extensions → `…` → **Install from VSIX…**, or run `antigravity --install-extension emrequest-<version>.vsix`.
  - On a Mac where `antigravity` isn't on the PATH, the tool is at `/Applications/Antigravity.app/Contents/Resources/app/bin/antigravity`.

### Internal rollout before it's public
Send the team the `.vsix` together with `scripts/install.sh` (Mac/Linux) or `scripts/install.ps1` (Windows). The script finds VS Code, Cursor, Antigravity and Windsurf on the machine and installs emRequest into each one it finds.

---

## Release checklist

- [ ] Version increased in `package.json`
- [ ] `CHANGELOG.md` updated
- [ ] `npm test` passes
- [ ] Installed the `.vsix` locally and clicked through: send, save, rename, environments, cURL import
- [ ] Uploaded to the VS Code Marketplace
- [ ] Published to Open VSX
- [ ] Searched for emRequest in Cursor and Antigravity a few hours later
- [ ] Tagged in git: `git tag v<version> && git push --tags`

## Things never to do

- Never commit a token to git or put it in `package.json`.
- Don't use **Remove** on the Marketplace unless you mean it. It deletes the stats and the name stays reserved for good. Use **Unpublish** to take it down temporarily.
