# Sharing a namespace

A namespace is one app's bucket — "Me", "Mum's medication", "Family
calendar". Sharing works per namespace, so you never hand anyone your
account, and they see nothing else you store.

## Roles

| Role     | Can                                                                        |
| -------- | -------------------------------------------------------------------------- |
| `viewer` | Read everything in the namespace                                           |
| `editor` | Read and write files and records, rename the namespace                     |
| `owner`  | Everything, plus invite, change roles, remove members, rotate keys, delete |

## Inviting

In the app: **Share → Invite**, pick a role, and show the QR code or send the
link. The invite carries a secret the server never sees; the namespace keys
travel sealed under it. Invites are single-use by default and expire after
seven days.

The person scanning it either uses their existing account on your server,
or gets a **guest** account created on the spot. Guests cannot create
namespaces of their own and have no storage quota — they exist only to take
part in what was shared with them.

## Removing someone

**Share → Members → Remove**. Their devices lose access immediately. For
anything sensitive, also **rotate the key** (the app offers it): new data is
then encrypted under a key the removed member never had, and the app
re-encrypts what is already there.

## Health data

The apps that ban iCloud for health data (meds, period, baby) offer this
backend: a caregiver can be given `viewer` access to exactly one person's
medication log, end-to-end encrypted, on a server you own.
