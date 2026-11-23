/**
 * The addresses the egress proxy never opens (rewrite plan R5c, decision I8): the private networks,
 * the loopback, the link-local ones and every network of the host's Docker. A plugin goes out to the
 * internet and to nothing of the homelab, whatever a name resolves to. `BlockList` also matches the
 * IPv4-mapped IPv6 form of an IPv4 range (`::ffff:10.0.0.1`).
 */
import { BlockList, isIP } from "node:net";

const FORBIDDEN: readonly (readonly [string, number, "ipv4" | "ipv6"])[] = [
  ["0.0.0.0", 8, "ipv4"], // "this" network
  ["10.0.0.0", 8, "ipv4"], // RFC 1918
  ["100.64.0.0", 10, "ipv4"], // shared address space: carrier NAT, the homelab's VPN
  ["127.0.0.0", 8, "ipv4"], // loopback
  ["169.254.0.0", 16, "ipv4"], // link-local
  // RFC 1918. Docker's default pools (172.17-31/16, 192.168/20) are inside it and the one below:
  // every network of the stack, `ledgerly_plugins` and `ledgerly_egress` included.
  ["172.16.0.0", 12, "ipv4"],
  ["192.168.0.0", 16, "ipv4"], // RFC 1918
  ["224.0.0.0", 3, "ipv4"], // multicast, reserved, broadcast
  ["::", 128, "ipv6"], // unspecified
  ["::1", 128, "ipv6"], // loopback
  ["fc00::", 7, "ipv6"], // unique local
  ["fe80::", 10, "ipv6"], // link-local
  ["ff00::", 8, "ipv6"], // multicast
];

const blocked = new BlockList();
for (const [network, prefix, family] of FORBIDDEN) blocked.addSubnet(network, prefix, family);

/** Whether the proxy refuses to connect to `address`; anything that is not an IP is refused too. */
export function isForbiddenAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true;
  return blocked.check(address, family === 4 ? "ipv4" : "ipv6");
}
