import { describe, expect, it } from "vitest";
import { isForbiddenAddress } from "./addresses.ts";

describe("the addresses the proxy refuses", () => {
  it.each([
    ["RFC 1918 10/8", "10.1.2.3"],
    ["RFC 1918 172.16/12", "172.31.255.254"],
    ["RFC 1918 192.168/16", "192.168.1.10"],
    ["loopback 127/8", "127.0.0.1"],
    ["link-local 169.254/16", "169.254.169.254"],
    ["this network 0/8", "0.0.0.0"],
    ["shared address space 100.64/10 (the VPN)", "100.92.1.1"],
    ["IPv6 loopback ::1", "::1"],
    ["IPv6 unique local fc00::/7", "fd12:3456::1"],
    ["IPv6 link-local fe80::/10", "fe80::1"],
    ["IPv4-mapped 10/8", "::ffff:10.0.0.1"],
    ["IPv4-mapped 127/8", "::ffff:127.0.0.1"],
    ["IPv4-mapped 192.168/16, hexadecimal", "::ffff:c0a8:0101"],
    ["Docker: ledgerly_plugins", "172.25.0.2"],
    ["Docker: the default bridge", "172.17.0.1"],
    ["Docker: a pool of 192.168/20", "192.168.16.3"],
    ["multicast", "224.0.0.251"],
    ["not an address", "example.com"],
  ])("refuses %s (%s)", (_name, address) => {
    expect(isForbiddenAddress(address)).toBe(true);
  });

  it.each(["93.184.215.14", "1.1.1.1", "2606:4700::1111", "172.32.0.1", "100.128.0.1"])(
    "opens the public address %s",
    (address) => {
      expect(isForbiddenAddress(address)).toBe(false);
    },
  );
});
