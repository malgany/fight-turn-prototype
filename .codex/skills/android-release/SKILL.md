---
name: android-release
description: Commit and push Fight Turn / Final Genesis changes, bump Android version, build a signed release AAB, then use the user's Chrome via the Codex extension to open Google Play Console at the Final Genesis internal test release creation screen. Use when the user asks to publish, prepare, build, upload, release, or generate an Android/Google Play internal test release for this project.
---

# Android Release

Use this workflow for this repository only: `E:\projects-game\Fight Turn`.

## Release Facts

- Package: `com.malganiplay.finalgenesis`
- Play Console developer account: `MALGANY PLAY©`
- Google account index: `u/1`
- Developer ID: `8946663153831936589`
- App ID: `4972209376419290126`
- Target track: `Teste interno`
- Track URL: `https://play.google.com/console/u/1/developers/8946663153831936589/app/4972209376419290126/tracks/internal-testing?releaseType=defaultReleases`
- New release prepare URL shape: `https://play.google.com/console/u/1/developers/8946663153831936589/app/4972209376419290126/tracks/4700337006519489256/releases/<release-number>/prepare`
- Final AAB path: `E:\projects-game\Fight Turn\android\app\build\outputs\bundle\release\app-release.aab`

## Local Build Workflow

1. Check repository state:

   ```powershell
   git status --short --branch
   ```

2. Bump Android version in `android/app/build.gradle` unless the user already did it or gave an explicit version:
   - Increment `versionCode` by `1`.
   - Increment the patch part of `versionName` by `1`.
   - Example: `versionCode 6` / `versionName "1.0.5"` becomes `versionCode 7` / `versionName "1.0.6"`.

3. Run tests:

   ```powershell
   npm test
   ```

4. Build the signed release AAB:

   ```powershell
   npm run android:aab
   ```

5. If Gradle fails with a missing `lint_model_metadata` / `lint-model-metadata.properties` intermediate file, run the clean release bundle command:

   ```powershell
   cd android
   .\gradlew.bat clean bundleRelease
   ```

6. Confirm the AAB exists:

   ```powershell
   Get-ChildItem android\app\build\outputs\bundle\release\app-release.aab
   ```

7. Stage and commit all relevant source changes:

   ```powershell
   git add -A
   git diff --cached --name-only | Select-String -Pattern 'build|dist|\.aab|\.apk'
   git diff --cached --stat
   git commit -m "feat: prepare Android release"
   ```

   Do not commit build outputs, APKs, AABs, `dist/`, or local Codex/Vite logs. If no source changes exist, skip the commit and report that there was nothing to commit.

8. Push the current branch:

   ```powershell
   git push origin main
   ```

   If the current branch is not `main`, confirm the intended branch from `git status --short --branch` and push that branch unless the user explicitly requested `main`.

## Play Console Workflow

Use the user's real Chrome controlled through the Codex Chrome extension. If the `prefer-chrome-browser` or browser-control skills are available, read them before browser work. Do not use the embedded browser unless the user explicitly approves fallback.

1. List browser surfaces and choose `Chrome` with `type: "extension"`.
2. Open a new Chrome tab.
3. Navigate directly to:

   ```text
   https://play.google.com/console/u/1/developers/8946663153831936589/app-list
   ```

4. Verify the app list contains:

   ```text
   Final Genesis
   com.malganiplay.finalgenesis
   ```

   Do not continue with any other app or package.

5. Open `Final Genesis`.
6. Open `Testar e lançar`.
7. Open `Teste interno`.
8. Verify the page title is `Teste interno | Final Genesis` and the latest version shown matches the previous Android release.
9. Click `Criar nova versão`.
10. Stop at the page `Criar versão de teste interno`, section `Pacotes de apps`, where the `Enviar` button is visible.

## User Handoff

Stop before uploading the AAB unless the user explicitly asked Codex to upload it. Tell the user:

- Current Play Console location: `Final Genesis` > `Teste interno` > `Criar versão de teste interno`.
- AAB path: `E:\projects-game\Fight Turn\android\app\build\outputs\bundle\release\app-release.aab`.
- Android version built.
- Test/build commands run and their result.
- Commit hash and pushed branch.

Ask the user to attach the AAB using the visible `Enviar` button, then continue only after they confirm upload is complete.

## Safety

- Do not publish, roll out, submit for review, discard drafts, change testers, change app signing, change integrity settings, or upload files without explicit user instruction at that step.
- If Play Console shows a login, password, 2FA, account chooser uncertainty, CAPTCHA, or permission prompt, stop and ask the user.
- If the app list does not show `Final Genesis` with package `com.malganiplay.finalgenesis`, stop and ask for the correct account/link.
