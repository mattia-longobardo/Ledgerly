import nextPackage from "next/package.json";
import appPackage from "../../package.json";

/**
 * What the Maintenance card prints (design row 889). Both versions are read from the packages at
 * build time, so nothing has to be kept in step by hand and no environment variable is invented
 * for something the image already knows (plan F8 §3.6.4).
 */
export const APP_VERSION: string = appPackage.version;
export const NEXT_VERSION: string = nextPackage.version;
