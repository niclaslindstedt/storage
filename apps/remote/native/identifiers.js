// THE ONE PLACE A DEPLOYMENT'S COORDINATES ENTER THIS REPOSITORY (the same
// three build variables as every other wrapper in the fleet).
//
//   APP_DISPLAY_NAME  the listing name, and the name under the icon
//   APP_BUNDLE_ID     iOS bundle identifier + Android package name
//   EAS_PROJECT_ID    the Expo project this builds against
//
// None is committed: a fresh checkout builds under the project name and a
// development id, and a production build refuses to start without them.

/** The project's own name. Not the listing name — see APP_DISPLAY_NAME. */
const PROJECT_NAME = "Storage Remote";

/** Reverse-DNS id used only by local/dev builds; never submitted. */
const DEV_BUNDLE_ID = "dev.local.storageremote";

const DISPLAY_NAME = process.env.APP_DISPLAY_NAME?.trim() || PROJECT_NAME;
const BUNDLE_ID = process.env.APP_BUNDLE_ID?.trim() || DEV_BUNDLE_ID;
const EAS_PROJECT_ID = process.env.EAS_PROJECT_ID?.trim() ?? "";

if (process.env.EAS_BUILD_PROFILE === "production") {
  for (const name of ["APP_DISPLAY_NAME", "APP_BUNDLE_ID", "EAS_PROJECT_ID"]) {
    if (!process.env[name]?.trim()) {
      throw new Error(
        `${name} is not set. A production build needs it — set it as an EAS ` +
          `environment variable on the EAS project. See README.md.`,
      );
    }
  }
}

module.exports = {
  PROJECT_NAME,
  DEV_BUNDLE_ID,
  DISPLAY_NAME,
  BUNDLE_ID,
  EAS_PROJECT_ID,
};
