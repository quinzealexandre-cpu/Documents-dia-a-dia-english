# Dia a Dia English

A self-hosted web app for practicing everyday English out loud. The interface is in
Brazilian Portuguese; the practice content is in English.

- 12 daily-life situations with 50 phrases each (600 in total): supermarket, restaurant, doctor, school, small talk,
  phone, street, bank/post office, clothes shopping, car, travel, emergencies
- **Falar (speaking):** she listens to the phrase, says it, and the app shows which words it understood and which to repeat
- **Ouvir (listening):** she hears the phrase and rebuilds it from shuffled word tiles
- **Conversar com a Amy (free conversation):** she picks any topic and talks with an AI tutor that answers
  out loud in simple English, corrects her grammar and vocabulary in Portuguese, and flags likely
  pronunciation problems. Needs an AI key, see below.
- Login and password, one account per person, progress saved per account

## Requirements

- Windows, macOS or Linux with **Python 3.8 or newer**. Nothing else to install.
- Google Chrome or Microsoft Edge on the laptop; Chrome on Android or Safari on iPhone.
- Internet access while practicing: the browser's speech recognition runs online.

## Start it

1. Double-click **`start.bat`** (or run `python server.py`).
2. The first time, Windows Firewall asks whether to allow Python. Tick **Private networks** and allow it,
   otherwise the phone cannot connect.
3. The browser opens `http://localhost:8080`. Create the administrator account (yours).
4. Go to **Conta → Criar nova conta** and create your wife's account.

Keep the black server window open while the app is in use.

## Use it on the phone

1. Connect the phone to the same Wi-Fi as the laptop.
2. Open the `https://...:8443` address printed in the server window, for example `https://192.168.1.20:8443`.
3. The browser warns that the certificate is not trusted. That is expected: the app creates its own
   certificate. Choose **Advanced → Proceed** (Chrome) or **Show Details → visit this website** (Safari).
4. Log in, and allow the microphone when asked.
5. Optional: browser menu → **Add to Home screen** to get an app icon.

The phone must use the `https://` address. Browsers block the microphone on plain `http://` pages,
except for `localhost` on the laptop itself.

## Turn on the conversation tutor (Amy)

The tutor is Claude, reached through Anthropic's API. It is billed by usage to your own Anthropic
account, separately from any Claude subscription.

1. Create an API key in the Claude Console (console.anthropic.com → API Keys) and add billing credit.
2. Give the key to the app as the setting `ANTHROPIC_API_KEY`:
   - **Render:** your service → Environment → add `ANTHROPIC_API_KEY` → save.
   - **Azure:** add it to the `az webapp config appsettings set` command.
   - **Laptop:** in a Command Prompt, run `set ANTHROPIC_API_KEY=your-key` and then `start.bat` in the same window.
3. Reload the app. "Conversar com a Amy" on the home screen now opens the conversation.

Optional settings: `APP_AI_MODEL` (default `claude-haiku-5-5`; a larger model gives richer corrections at
higher cost) and `APP_AI_DAILY_TURNS` (default 300 sentences per person per day, a spending guard).

How it works and what it cannot do:
- The browser turns her speech into text; the text (never the audio) goes to Claude with the conversation so far.
- Grammar and vocabulary corrections are reliable. Pronunciation feedback is indirect: the tutor only
  sees what the speech recognizer understood, so it flags words that came out as something else, and
  the "Repetir" button checks whether the corrected sentence is understood. It cannot judge accent or
  individual sounds.
- "Não sei dizer em inglês" lets her say something in Portuguese; Amy teaches the English for it.
- Amy waits until she has been quiet for about 1.3 seconds before answering, so a pause between words does
  not cut her off. Tapping the microphone button again sends the sentence at once. The wait is the
  `END_PAUSE_MS` value near the top of the conversation code in `static/app.js`.
- Conversations are not stored on the server.

## Free test hosting on Render

Render's free plan needs no credit card and gives the app a public `https://` address, so it works on
any phone, anywhere, with no certificate warning.

1. Create a free account at github.com (or use yours), create a new **private** repository, and upload
   the contents of this folder (Add file → Upload files; drag everything in, including `static`).
2. Sign up at render.com with that GitHub account.
3. In Render: **New → Blueprint**, pick the repository. Render reads `render.yaml` and asks for these values
   (`ANTHROPIC_API_KEY` is only needed for the conversation tutor):
   `APP_ADMIN_USER`, `APP_ADMIN_PASSWORD` (your login) and `APP_STUDENT_USER`, `APP_STUDENT_PASSWORD`
   (her login). Passwords need at least 8 characters.
4. When the deploy finishes, open the `https://….onrender.com` address Render shows and log in.

What the free plan means:
- The app sleeps after 15 minutes without visits; the next visit takes about a minute to wake it.
- Render erases the app's disk whenever it sleeps or restarts. The two logins above are recreated
  automatically, but **practice progress and any other accounts are lost each time**. Fine for testing,
  not for daily use.

## Host it on Azure (Microsoft cloud)

The same code runs on Azure App Service. It detects Azure automatically: it listens on the port Azure
assigns, relies on Azure's own HTTPS certificate (no browser warning) and keeps `app.db` in `/home/data`,
which survives restarts and redeployments.

You need an Azure subscription on your Microsoft account. Then, in **Azure Cloud Shell** (the `>_` icon
at the top of portal.azure.com), upload `azure-deploy.zip` and run, replacing the two values in capitals:

```
az group create -n dia-a-dia -l eastus
az appservice plan create -g dia-a-dia -n dia-a-dia-plan --is-linux --sku F1
az webapp create -g dia-a-dia -p dia-a-dia-plan -n UNIQUE-APP-NAME --runtime "PYTHON:3.12"
az webapp config set -g dia-a-dia -n UNIQUE-APP-NAME --startup-file "python server.py"
az webapp config appsettings set -g dia-a-dia -n UNIQUE-APP-NAME --settings APP_SETUP_CODE=A-SECRET-PHRASE
az webapp update -g dia-a-dia -n UNIQUE-APP-NAME --https-only true
az webapp deploy -g dia-a-dia -n UNIQUE-APP-NAME --src-path azure-deploy.zip --type zip
```

Open `https://UNIQUE-APP-NAME.azurewebsites.net`. The first-account screen asks for the secret phrase
(`APP_SETUP_CODE`), so a stranger who finds the address cannot claim the administrator account.

Notes:
- `--sku F1` is the free plan (60 CPU minutes per day, the app sleeps when idle). `--sku B1` is the
  smallest paid plan and stays awake.
- If `PYTHON:3.12` is rejected, list the current names with `az webapp list-runtimes --os linux`.
- These steps were tested against a simulated Azure environment, not a real subscription.
- If progress fails to save with a "database is locked" error in the log stream, tell Claude: the
  database then needs a different storage setting for Azure's network disk.

## Security

- Passwords are stored only as salted scrypt hashes.
- Sessions use a random token in an HttpOnly, SameSite=Strict cookie (Secure over HTTPS), valid for 30 days.
- Five wrong passwords for an account lock that login for 10 minutes.
- Only the administrator can create accounts, reset passwords or delete accounts. There is no public sign-up.
- The administrator can suspend an account (Conta → Pessoas com acesso → Suspender). A suspended person is
  logged out everywhere and cannot log in, but keeps their progress; Reativar restores access.
- Traffic from the phone is encrypted (TLS 1.2+). The plain `http://localhost:8080` address only answers on the laptop itself.
- Everything lives in the `data` folder: `app.db` (accounts and progress), `cert.pem`, `key.pem`.
  Back up `app.db` to keep progress. Delete the `data` folder to reset everything.

## Limits of this first version

- It works at home, on your Wi-Fi, while the laptop is on. To use it at the store or anywhere else,
  the laptop needs a private tunnel such as Tailscale.
- Pronunciation feedback is word-level: it shows which words the recognizer understood. It does not
  analyze individual sounds, and the phrase drills do not correct grammar; the conversation tutor does.
- If the laptop's IP address changes, the phone address changes too. The server window always prints the current one.

## Files

| File | Purpose |
| --- | --- |
| `server.py` | Web server, login, API, database |
| `certgen.py` | Creates the HTTPS certificate on first start |
| `content.json` | Situations, phrases, translations and tips. Edit this to add your own. |
| `static/` | The app screens (HTML, CSS, JavaScript) |
| `start.bat` | Windows launcher (local hosting) |
| `requirements.txt` | Empty on purpose; tells the cloud host this is a Python app |
| `render.yaml` | Settings Render reads when you create the service |

Ports can be changed with the environment variables `APP_HTTPS_PORT` and `APP_LOCAL_PORT`.
