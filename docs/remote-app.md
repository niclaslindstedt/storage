# Storage Remote

Storage Remote is the hoster's own app. From a phone, you can do everything
the [admin console](admin-console.md) does: add people, pair their devices,
watch health, traffic and logs, fix problems. You can also keep your own
files on the server, the way you would use Dropbox, end-to-end encrypted on
the phone before they leave it. It is meant for the person who runs the
server, not for the people they host.

It is a web app (`apps/remote`) wrapped for iOS and Android by a thin native
shell (`apps/remote/native`). The shell serves the app from inside the
download and keeps its keys in the Keychain / Android Keystore.

## Pair your phone as an admin device

1. On the machine that runs the server, open the admin console
   (`storage-server admin`), go to **Accounts** and press **Pair admin app**
   on your own admin account. Or run:

   ```sh
   storage-server pair --account <you> --console
   ```

2. Open Storage Remote and scan the code (or paste the link).
3. Your encryption key comes from one of three places:
   - **First device of the account**: the app creates the key and shows
     your **recovery key** once. Write it down.
   - **Another device already has it**: approve the phone there after
     checking that both show the same safety code.
   - **You have the recovery key**: enter it.

The pairing code signs the phone in and nothing more. Keys never pass
through the server.

Only the local console and the CLI can pair an admin device. An admin
device can add accounts and show pairing codes for ordinary devices, but
never for another admin device. So a stolen phone cannot hand out admin
access. If you lose the phone, revoke it on the **Devices** page. To keep a
phone but stop it running the server, choose **Remove admin access** there.

## What it shows

| Tab        | What it is for                                                                                                                                                                                                                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Files      | Your shared folders. Upload from the phone (large files go up in parts), make folders, save or share a file, rename, delete, restore an earlier version, empty the trash. **Share** a folder with an invite QR code (view or edit, one use, expiring). Remove someone and the folder gets a new key. |
| Server     | The admin console itself, every page: Overview, Accounts, Devices, Namespaces, Traffic, Logs (live), Audit log, Troubleshoot. Changes are audited under this phone's device id.                                                                                                                      |
| This phone | What it is paired to and its safety code; approve your other devices; add a device by QR code; make a new recovery key; sign out.                                                                                                                                                                    |

A shared folder is one namespace of the `drive` app, with its own key. File
and folder names are sealed on the phone like the contents. The console's
Namespaces page shows the folder as an id, an owner and a size.

A paired device that is not an admin device can use the Files and This
phone tabs. The Server tab then explains how to pair it as an admin device.

## Requirements

- **A certificate phones trust**: `--tls acme`, `--tls files`, or TLS
  terminated by a proxy or tunnel. Phones refuse plain HTTP to anything but
  themselves, and a WebView cannot pin the self-signed mode's key.
- **The remote console on** (the default). `--remote-console off` turns it
  off for every device.

## How it works

The console's pages are one dependency-free TypeScript module
(`packages/server/src/admin/ui`). The console serves them with its session
cookie. Storage Remote mounts the same pages and swaps only their
transport: `/api/…` becomes `/v1/console/…` on the device API, signed in with
the phone's device key. The server routes those requests into the console's
own handlers. Nothing is reimplemented, so the two stay identical.

The files use the oss-framework self-hosted client, the same one every app
uses.

The native shell adds three capabilities the page looks for, and it never
asks whether it runs natively:

| Capability                  | Native                                  | In a browser               |
| --------------------------- | --------------------------------------- | -------------------------- |
| Key vault (`__ossKeyVault`) | Keychain / Android Keystore, this phone | IndexedDB, non-extractable |
| QR scanner                  | The camera                              | Paste the code             |
| Share sheet                 | Save to Files, AirDrop, other apps      | A download                 |

See `apps/remote/README.md` and `apps/remote/native/README.md` to build it.
