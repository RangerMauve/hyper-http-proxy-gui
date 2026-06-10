import { encode, decode } from "hypercore-id-encoding";

export const SCHEME = "hyper+http:";

/**
 * Parse the public key from a URL
 * @param {string} url `hyper+http://` URL to parse
 * @returns {Buffer}
 */
export function parseURL(url) {
  const { hostname } = new URL(url);

  return decode(hostname);
}

/**
 * Encode a public key into a `hyper+http` URL
 * @param {Buffer} publicKey
 * @returns {string}
 */
export function makeURL(publicKey) {
  const hostname = encode(publicKey);
  return `${SCHEME}//${hostname}/`;
}
