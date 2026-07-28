/**
 * Generate the PWA icon set.
 *
 * Written as a tiny PNG encoder rather than pulling in an image library: the
 * mark is simple geometry, and a build-time dependency for four static files
 * is not worth carrying.
 *
 * Run with: node scripts/generate-icons.mjs
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

// Matches --accent / --bg-raised in the light theme.
const TEAL = [47, 111, 98];
const CREAM = [246, 245, 242];

// ── PNG encoding ───────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[n] = c;
    }
    return table;
})();

/**
 * @param {Buffer} buf
 * @returns {number}
 */
const crc32 = (buf) => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
        c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
};

/**
 * @param {string} type
 * @param {Buffer} data
 * @returns {Buffer}
 */
const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typeAndData), 0);
    return Buffer.concat([length, typeAndData, crc]);
};

/**
 * @param {number} width
 * @param {number} height
 * @param {Buffer} rgba - width*height*4 bytes
 * @returns {Buffer}
 */
const encodePNG = (width, height, rgba) => {
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;  // bit depth
    ihdr[9] = 6;  // colour type: RGBA
    ihdr[10] = 0; // deflate
    ihdr[11] = 0; // adaptive filtering
    ihdr[12] = 0; // no interlace

    // Each scanline is prefixed with its filter type byte.
    const raw = Buffer.alloc(height * (width * 4 + 1));
    for (let y = 0; y < height; y++) {
        const rowStart = y * (width * 4 + 1);
        raw[rowStart] = 0;
        rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
    }

    return Buffer.concat([
        signature,
        chunk('IHDR', ihdr),
        chunk('IDAT', deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0)),
    ]);
};

// ── The mark ───────────────────────────────────────────────────────────────

/**
 * Draw the SafeSignal mark: a shield outline with a steady centre dot, on a
 * rounded teal field.
 *
 * @param {number} size
 * @param {boolean} maskable - if true, inset the art so platform masks cannot
 *   crop it (the safe zone is the central 80%)
 * @returns {Buffer} RGBA pixels
 */
const drawIcon = (size, maskable = false) => {
    const px = Buffer.alloc(size * size * 4);
    const cornerRadius = maskable ? 0 : size * 0.22;
    const scale = maskable ? 0.62 : 0.78;

    const cx = size / 2;
    const cy = size / 2;

    /** Signed check: is (x,y) inside the rounded square field? */
    const inField = (x, y) => {
        if (maskable) return true; // full bleed; the mask does the shaping
        const dx = Math.max(cornerRadius - x, 0, x - (size - cornerRadius));
        const dy = Math.max(cornerRadius - y, 0, y - (size - cornerRadius));
        return dx * dx + dy * dy <= cornerRadius * cornerRadius;
    };

    const shieldHalfWidth = (size * scale) / 2;
    const shieldTop = cy - shieldHalfWidth * 1.05;
    const shieldBottom = cy + shieldHalfWidth * 1.05;

    /**
     * Distance-ish test for a shield silhouette: a rounded rectangle at the top
     * tapering to a point at the bottom.
     */
    const shieldEdge = (x, y) => {
        if (y < shieldTop || y > shieldBottom) return Infinity;
        const t = (y - shieldTop) / (shieldBottom - shieldTop);
        // Full width for the top ~55%, then taper to a point.
        const taper = t < 0.55 ? 1 : 1 - ((t - 0.55) / 0.45) ** 1.5;
        const halfWidth = shieldHalfWidth * 0.72 * Math.max(taper, 0);
        return Math.abs(x - cx) - halfWidth;
    };

    const strokeWidth = size * 0.055;
    const dotRadius = size * 0.075;

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const i = (y * size + x) * 4;
            const sx = x + 0.5;
            const sy = y + 0.5;

            if (!inField(sx, sy)) {
                px[i + 3] = 0;
                continue;
            }

            // Teal field
            px[i] = TEAL[0];
            px[i + 1] = TEAL[1];
            px[i + 2] = TEAL[2];
            px[i + 3] = 255;

            // Shield outline: vertical sides tapering to a point...
            const edge = shieldEdge(sx, sy);
            const onSides = Math.abs(edge) <= strokeWidth / 2 && Number.isFinite(edge);

            // ...plus a cap across the top, without which the mark reads as a
            // open "U" rather than a closed shield.
            const onTop =
                Math.abs(sy - shieldTop) <= strokeWidth / 2 &&
                Math.abs(sx - cx) <= shieldHalfWidth * 0.72 + strokeWidth / 2;

            const onOutline = onSides || onTop;

            // Centre dot, sitting slightly above the visual middle of the shield
            const dotDy = sy - (cy - shieldHalfWidth * 0.05);
            const inDot = (sx - cx) ** 2 + dotDy ** 2 <= dotRadius * dotRadius;

            if (onOutline || inDot) {
                px[i] = CREAM[0];
                px[i + 1] = CREAM[1];
                px[i + 2] = CREAM[2];
            }
        }
    }

    return px;
};

// ── Emit ───────────────────────────────────────────────────────────────────

mkdirSync(OUT_DIR, { recursive: true });

const targets = [
    { file: 'icon-192.png', size: 192, maskable: false },
    { file: 'icon-512.png', size: 512, maskable: false },
    { file: 'icon-maskable-512.png', size: 512, maskable: true },
    { file: 'apple-touch-icon.png', size: 180, maskable: true },
];

for (const { file, size, maskable } of targets) {
    const png = encodePNG(size, size, drawIcon(size, maskable));
    writeFileSync(join(OUT_DIR, file), png);
    console.log(`${file.padEnd(26)} ${size}x${size}  ${(png.length / 1024).toFixed(1)} kB`);
}
