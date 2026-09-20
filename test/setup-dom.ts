import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

// `findBy…` waits 1 s by default, and under the whole suite a Server Action mock answering through a
// transition does not always make it: the DOM tests failed one run in a few, never alone. 5 s only
// costs time when something is really missing.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  cleanup();
});
