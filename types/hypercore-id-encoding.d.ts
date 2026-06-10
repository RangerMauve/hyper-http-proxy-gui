declare module 'hypercore-id-encoding' {
  /**
   * Encode a 32-byte Buffer to a z-base32 string.
   * @param key - A 32-byte Buffer representing a Hypercore key
   * @returns A z-base32 encoded string
   * @throws Error if key is not a Buffer or is not 32 bytes
   */
  export function encode(key: Buffer): string;

  /**
   * Decode a Hypercore key ID to a 32-byte Buffer.
   * Accepts z-base32 strings (52 chars), hex strings (64 chars),
   * pear:// URLs, or a 32-byte Buffer.
   * @param id - The Hypercore key ID to decode
   * @returns A 32-byte Buffer
   * @throws Error if the input is not a valid Hypercore key
   */
  export function decode(id: string | Buffer): Buffer;

  /**
   * Normalize a Hypercore key to a canonical z-base32 string.
   * Decodes the input and then encodes it.
   * @param value - A Hypercore key (string or Buffer)
   * @returns A z-base32 encoded string
   */
  export function normalize(value: string | Buffer): string;

  /**
   * Check if a value is a valid Hypercore key.
   * @param value - The value to check (string or Buffer)
   * @returns true if the value can be decoded as a valid Hypercore key
   */
  export function isValid(value: string | Buffer): boolean;
}
