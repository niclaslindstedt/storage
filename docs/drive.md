# Your files in the browser

The web drive is Dropbox for your own storage server. Sign in any browser
with a code, then browse your shared folders, upload, preview, download,
rename, share and delete. You can see every earlier version of a file,
compare two versions of a text file line by line, and restore either one.
Changes made on your phone, another computer, or by someone you share a
folder with show up at once, and the **Activity** page lists them as they
happen.

It is at **<https://niclaslindstedt.github.io/storage/drive/>**, built from
`apps/drive` into the website. Like every app on this server, it encrypts
and decrypts in the browser. The server, and the website that serves the
page, only ever see ciphertext.

## Sign in

The server has no passwords. A browser signs in with a one-time code that
makes it a device of your account. You can get one in two ways:

- **From a device you already use**: in Storage Remote, open **This
  phone → Add a device** and paste the code it shows into the drive. Your
  encryption key comes along, so the drive opens straight away.
- **From whoever runs the server**: the admin console's **Accounts → Pair
  device** on your account, or:

  ```sh
  storage-server pair --account <you>
  ```

  Paste the code. The browser then needs your encryption key. If this is
  your account's first device, it creates the key and shows your
  **recovery key** once. Otherwise, approve the browser from another device
  after checking that both show the same safety code, or enter your
  recovery key.

A code works once and expires after ten minutes. A link of the form
`…/drive/#oss=<code>` fills it in and is wiped from the address bar at once.

**This browser** shows the devices of your account, approves waiting ones,
adds another device by code, makes a new recovery key, and signs the
browser out. Signing out erases this browser's keys.

## Files

The first level is your **shared folders**. Each is a namespace of the
`drive` app with its own encryption key, so you can share one without
sharing anything else. Storage Remote uses the same folders, so the phone
and the browser show the same files. Inside a folder you can:

- **Upload** with the button, or drag files from the desktop onto the
  list. Large files go up in parts.
- **Open** a file: text and pictures are shown in the browser. Anything
  else is downloaded.
- **Replace**: upload a file whose name is taken and choose **Replace**. It
  becomes a new version of the same file, and the one it replaced is kept.
  **Keep both** saves it as `name (2)` instead. Replacing is a
  compare-and-swap: if another device changed the file meanwhile, nothing
  is overwritten and you are told.
- **Rename**, **move into folders**, **delete** to the trash, **restore**
  from the trash, or delete for good.
- **Share** a folder by invite, remove members (which rotates the key), or
  **join** a folder someone shared with you.

## Versions and differences

When a file is overwritten, the server keeps the version it replaced for
**30 days** by default. The admin can change that in the console's
**Settings** page (see [Admin console](admin-console.md#settings)). The
30 days count from the moment a version was replaced, so a file untouched
for a year still keeps its old content for the full window after you
overwrite it. A file keeps at most 100 versions. Earlier versions count
against the folder owner's quota.

**Versions** lists every version with its time and size. From there you
can download or restore any of them. Restoring makes that content the
current version again, and keeps the one it replaces. For text files
(Markdown, CSV, JSON, code and so on), **Changes** shows what a version
changed compared with the one before. **Compare** takes any two versions.
Lines added are green, removed ones red, each with its line number.
**Copy as diff** copies the comparison in `diff -u` form.

The comparison runs in the browser: both versions are downloaded,
decrypted and compared on your device. The server cannot tell text from
binary, let alone compare it. Only text up to 2 MiB is compared. Other
files show their sizes.

## Sync

The pill at the top right shows the state of the browser's connection:

| State      | Means                                                             |
| ---------- | ----------------------------------------------------------------- |
| Up to date | Every shared folder is at the server's latest version             |
| Syncing…   | A folder changed and its changes are being fetched and decrypted  |
| Offline    | The server cannot be reached; the drive keeps retrying on its own |

The server pushes a small event when a folder changes (`/v1/events`). The
event says only that the folder changed, never what changed. The drive
then fetches the folder's change feed from where it left off, decrypts
it, and updates the open folder and the **Activity** page. Every 30
seconds it also compares each folder's position with the server's, so a
missed event or a dropped connection catches up by itself.

## Requirements

- **HTTPS with a publicly trusted certificate** (`--tls acme`, or a
  reverse proxy with one). The drive is served over HTTPS, and a browser
  refuses to reach a plain-HTTP or self-signed server from it. A server on
  `localhost` works for trying it out.
- The server learns the drive's origin when the browser signs in (CORS
  `paired`, the default). With `--cors-origin`, list
  `https://niclaslindstedt.github.io` explicitly.

## Hosting the drive yourself

The drive is a static page: `make drive` builds it into `apps/drive/dist`,
and any web server can serve that folder, at any path. Serve it yourself
when you would rather not load the page that holds your keys from the
project's website, or when the server is reachable only on your network.
The page's content security policy lets it load only its own files and talk
only to storage servers.

## Security

- **Keys stay in the browser.** They are kept in IndexedDB as
  non-extractable WebCrypto keys, one vault per app (`storage-drive`), and
  are never sent anywhere. Sign-in codes are single-use and short-lived.
- **Trust the page you load.** Whoever serves the page's code could change
  it, which is true of every web app that encrypts in the browser. The
  published drive is built by CI from this repository and served by
  GitHub Pages. To depend on neither, host the build yourself (above).
- **Lost the laptop?** Revoke its browser from another device (**This
  phone** in Storage Remote, **This browser** in the drive), or from the
  admin console's **Devices**. Its keys stop working at once.

See also [Security model](security.md).
