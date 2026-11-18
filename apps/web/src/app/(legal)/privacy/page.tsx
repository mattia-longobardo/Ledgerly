import { legalRoute } from "../legal-page";

const route = legalRoute("privacy");

export const generateMetadata = route.generateMetadata;
export default route.Page;
