import { describe, expect, it } from "vitest";
import { parseSectionQuery } from "@ledgerly/ui/period";
import type { ServicePage } from "../service/service-view";
import { activityHref, filtersOf } from "./activity-view";

const ASSET = "091a2b3c-4d5e-4f60-9172-1a2b3c4d5e6f";

/** A service page of the address `search`, with one asset of its own. */
function pageOf(search: string): ServicePage {
  const params = new URLSearchParams(search);
  return {
    id: "c5d6e7f8-0912-4a3b-8c4d-d6e7f8091a2b",
    search: params,
    section: parseSectionQuery(Object.fromEntries(params.entries()), "2026-11-21"),
    overview: { service: { assets: [{ id: ASSET, name: "World" }] } },
  } as unknown as ServicePage;
}

describe("the filters of a service's Activity", () => {
  it("read the family, the text and an asset of the service, and the page", () => {
    expect(filtersOf(pageOf(`type=trades&q=+etf+&asset=${ASSET}&p=3`))).toEqual({
      family: "trades",
      q: "etf",
      asset: { id: ASSET, name: "World" },
      page: 3,
    });
  });

  it("leave out what they cannot read: an unknown family, an asset the service does not have", () => {
    expect(filtersOf(pageOf("type=nope&asset=other&p=x"))).toEqual({
      family: null,
      q: null,
      asset: null,
      page: 1,
    });
  });

  it("keep the others in a link and start it on the first page", () => {
    const page = pageOf(`preset=all&type=income&p=2`);
    expect(activityHref(page, filtersOf(page))({ type: undefined })).toBe(
      "/investments/c5d6e7f8-0912-4a3b-8c4d-d6e7f8091a2b/activity?preset=all",
    );
  });
});
