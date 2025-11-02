import { crypto } from "@std/crypto";
import { encodeHex } from "@std/encoding/hex";

async function md5(input: string): Promise<string> {
  const hashBuffer = await crypto.subtle.digest(
    "MD5",
    new TextEncoder().encode(input)
  );
  const hash = encodeHex(hashBuffer);

  return hash;
}

export { md5 };
