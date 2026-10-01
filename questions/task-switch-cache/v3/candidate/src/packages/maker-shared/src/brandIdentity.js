import { BRAND_NAME as BRAND_NAME } from "./branding.js";
export const BRAND_IDENTITY = Object.freeze({
    displayName: BRAND_NAME,
    executableName: 'Cindy',
    executableNameByRegion: Object.freeze({
        cn: 'Cindy',
        global: 'Cindy',
        dev: 'CindyDev',
    }),
    appIdByRegion: Object.freeze({
        cn: 'com.xd.cindycn',
        global: 'com.xd.cindy',
        dev: 'com.xd.cindydev',
    }),
    primaryScheme: 'cindy',
    legacySchemes: Object.freeze(['xdt-maker']),
    userDataDirName: 'Cindy',
    userDataDirNameByRegion: Object.freeze({
        cn: 'Cindy',
        global: 'CindyGlobal',
        dev: 'CindyDev',
    }),
    legacyUserDataDirNames: Object.freeze(['xdt-maker']),
    legacyUserDataDirNamesByRegion: Object.freeze({
        cn: Object.freeze(['xdt-maker']),
        global: Object.freeze([]),
        dev: Object.freeze([]),
    }),
    legacyDialogueUserDataDirNamesByRegion: Object.freeze({
        cn: Object.freeze(['xdt-maker']),
        global: Object.freeze([]),
        dev: Object.freeze([]),
    }),
    cdnPrefix: 'cindy',
    updaterName: 'cindy-updater',
    dbFilePrefix: 'cindy',
    legacyDbFilePrefixes: Object.freeze(['xdt-maker']),
});
export function allDeepLinkSchemes(identity = BRAND_IDENTITY) {
    return [identity.primaryScheme, ...identity.legacySchemes];
}
