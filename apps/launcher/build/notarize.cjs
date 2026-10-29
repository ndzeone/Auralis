module.exports = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID, CSC_LINK } = process.env;
  const supplied = [APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID].filter(Boolean).length;
  if (supplied !== 0 && (supplied !== 3 || !CSC_LINK)) throw new Error('Notarization requires APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID, and a Developer ID signing certificate (CSC_LINK).');
  if (supplied === 0) {
    console.log('Notarization skipped: Apple Developer signing credentials were not provided.');
    return;
  }
  const { notarize } = await import('@electron/notarize');
  await notarize({
    appPath: `${context.appOutDir}/${context.packager.appInfo.productFilename}.app`,
    appleId: APPLE_ID,
    appleIdPassword: APPLE_APP_SPECIFIC_PASSWORD,
    teamId: APPLE_TEAM_ID,
  });
};
