# Setting up the Google side

This is the only fiddly part, and it is unavoidable: Google Photos has no API
keys and no service accounts. The only way in is an OAuth client that you own,
in a Google Cloud project that you own, authorised by the account whose photos
you want to reach.

Budget about ten minutes. You do this once.

Console labels move around. Where a step below names a button, that is what it
was called at the time of writing. Where it describes a goal instead, that is
deliberate: the wording there changes often enough that a name would age badly.

---

## Before you start

You need a Google account. Any account works, personal or Workspace. It has to
be the same account that owns the photos, or one you are willing to sign in as.

Nothing here costs money. The Photos APIs have no billing requirement and you
will not be asked for a card.

---

## 1. Create a project

Go to the [Google Cloud console](https://console.cloud.google.com/) and create a
new project. Give it a name you will recognise in six months.

A project is just a container for the API access and the OAuth client. Reusing
an existing project is fine, but a fresh one keeps this credential separate from
everything else you have built, which makes it safe to delete later.

---

## 2. Turn on the two APIs

Google Photos is two separate APIs and this server uses both. Enabling one and
not the other produces a confusing half-working state, where picking photos
works and albums return `403`, or the reverse.

Enable both:

- [Photos Picker API](https://console.cloud.google.com/apis/library/photospicker.googleapis.com)
- [Photos Library API](https://console.cloud.google.com/apis/library/photoslibrary.googleapis.com)

Each link opens that API's page in your project. Click the button to enable it,
then go back and do the other one.

Check you are in the right project first. The project picker sits in the top bar
and enabling an API in the wrong project is the single most common way to lose
half an hour here.

---

## 3. Configure the consent screen

This lives under **Google Auth Platform** in the console. If the project has
never been set up, its overview page offers a **Get started** button that walks
through the same fields.

You will be asked for:

**App name.** Shown to you on the consent screen. Pick something plain like
`Photos MCP`. Google rejects names that contain its own product names, so
anything with "Google" or "Photos App" in it will bounce.

**User support email.** Your own address, from the dropdown.

**Audience.** Choose **External** unless you have a Google Workspace
organisation and want to restrict this to people inside it.

**Contact information.** Your email again. This one is for Google to reach you.

---

## 4. Add yourself as a test user

Still under Google Auth Platform, on the **Audience** page, add your own Google
account as a test user.

This is easy to skip and it is what causes `access_denied` at the end of the
sign-in flow. While the app's publishing status is **Testing**, only accounts on
that list may authorise it, up to 100 of them.

### The seven-day catch

**In Testing, an authorisation expires seven days after you grant it, and the
refresh token expires with it.** Your setup will work perfectly and then stop a
week later for no visible reason.

Two ways to deal with it:

- Re-run `google-photos-mcp auth` when it stops. Fine for occasional use.
- Set the publishing status to **In production** on the same page. Refresh
  tokens then last until they are revoked.

Publishing does not require Google's verification review for personal use. You
will see an "unverified app" warning during sign-in, which you can click past.
Verification only matters if other people are going to use your app, and Google
Photos scopes require a separate review on top of the usual one.

---

## 5. Add the scopes

On the **Data access** page, add these four scopes:

```
https://www.googleapis.com/auth/photospicker.mediaitems.readonly
https://www.googleapis.com/auth/photoslibrary.appendonly
https://www.googleapis.com/auth/photoslibrary.readonly.appcreateddata
https://www.googleapis.com/auth/photoslibrary.edit.appcreateddata
```

If a scope is not in the list you can paste it in manually.

You may see older guides asking for `photoslibrary` or
`photoslibrary.readonly`. **Do not add those.** Google removed them on 1 April
2025 and a project requesting one now fails at the consent screen rather than
degrading gracefully. The four above are the complete set still available.

---

## 6. Create the OAuth client

On the **Clients** page, create a new client.

**Application type: Web application.** Not "Desktop app". A desktop client
cannot be given a redirect URI, and this server needs one so the sign-in
command can catch the response.

**Authorised redirect URI:** add exactly this, with no trailing slash:

```
http://localhost:4180
```

That port is where `google-photos-mcp auth` listens. If 4180 is busy on your
machine, pick another, register `http://localhost:<your port>` here instead, and
set `GOOGLE_PHOTOS_AUTH_PORT` to match. The string has to match byte for byte or
Google returns `redirect_uri_mismatch`.

Save, and copy the **client ID** and **client secret**. The secret is shown once.

---

## 7. Get a refresh token

Back in a terminal:

```bash
export GOOGLE_PHOTOS_CLIENT_ID="your-client-id"
export GOOGLE_PHOTOS_CLIENT_SECRET="your-client-secret"

npx -y @thenavidm/google-photos-mcp@latest auth
```

A browser opens. Sign in as the account whose photos you want, click past the
unverified-app warning, and approve the four permissions.

The command prints a refresh token. That is the third credential.

If it prints no refresh token, this account has already consented to this client
before. Remove the app at
[myaccount.google.com/permissions](https://myaccount.google.com/permissions) and
run it again.

---

## 8. Put the three values in your client config

See the README for the exact block for your MCP client. All three go in, and
then:

```bash
npx -y @thenavidm/google-photos-mcp@latest doctor
```

`doctor` checks the credentials, mints a token, verifies every scope actually
landed in the grant, and makes one real API call. It stops at the first genuine
problem rather than listing four symptoms of one cause.

---

## When something is wrong

**`redirect_uri_mismatch`**: the URI in the client does not byte-match
`http://localhost:4180`. Check for a trailing slash, `https` instead of `http`,
or `127.0.0.1` instead of `localhost`.

**`access_denied` after signing in**: your account is not on the test user
list, or you signed in as a different account than the one you added.

**`invalid_client`**: the client id or secret is wrong for this project. Also
check for a stray newline: a value pasted out of a quoted string can carry a
literal `\n`, which is invisible and fails identically.

**`invalid_grant`, and it worked yesterday**: seven days have passed and the
app is still in Testing. Publish it, or re-run `auth`.

**`403` on anything that reads photos**: expected. Nothing can read a library
it did not upload to. Use `start_pick_session` and let the user choose.

**Everything returns `403` including uploads**: the grant is missing a scope.
Run `doctor`; it names which one. Adding a scope in the console does not upgrade
a token that already exists, so you have to run `auth` again.
