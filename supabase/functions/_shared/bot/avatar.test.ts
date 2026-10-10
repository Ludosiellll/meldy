// The profile photo (spec §5): a JPG, 640×640, the bytes the comment's hash names.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { AVATAR_SHA256, AVATAR_SIZE, avatarBytes } from './avatar.ts';

/** Width and height from the JPEG's start-of-frame segment. */
function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (marker >= 0xc0 && marker <= 0xc3) return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] };
    i += 2 + length;
  }
  return null;
}

test('the avatar is the JPG its hash names, 640×640, small enough for the bundle', () => {
  const bytes = avatarBytes();
  assert.equal(createHash('sha256').update(bytes).digest('hex'), AVATAR_SHA256);
  assert.deepEqual([bytes[0], bytes[1], bytes[2]], [0xff, 0xd8, 0xff]);
  assert.deepEqual([bytes[bytes.length - 2], bytes[bytes.length - 1]], [0xff, 0xd9]);
  assert.deepEqual(jpegSize(bytes), AVATAR_SIZE);
  assert.deepEqual(AVATAR_SIZE, { width: 640, height: 640 });
  assert.ok(bytes.length > 5_000 && bytes.length < 100_000);
});
