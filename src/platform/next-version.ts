import nextPackage from "next/package.json";

/** The Next.js version the Maintenance card prints, read from the package at build time (plan F8 §3.6.4). */
export const NEXT_VERSION: string = nextPackage.version;
