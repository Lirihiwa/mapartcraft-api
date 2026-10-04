const coloursJSON = require("../../src/components/mapart/json/coloursJSON.json");
const ditherMethods = require("../../src/components/mapart/json/ditherMethods.json");
const labCache = new Map();

function rgb2lab(rgb) {
    const key = (rgb[0] << 16) + (rgb[1] << 8) + rgb[2];
    if (labCache.has(key)) return labCache.get(key);

    let r1 = rgb[0] / 255.0;
    let g1 = rgb[1] / 255.0;
    let b1 = rgb[2] / 255.0;

    r1 = 0.04045 >= r1 ? r1 / 12.0 : Math.pow((r1 + 0.055) / 1.055, 2.4);
    g1 = 0.04045 >= g1 ? g1 / 12.0 : Math.pow((g1 + 0.055) / 1.055, 2.4);
    b1 = 0.04045 >= b1 ? b1 / 12.0 : Math.pow((b1 + 0.055) / 1.055, 2.4);

    const f = (0.43605202 * r1 + 0.3850816 * g1 + 0.14308742 * b1) / 0.964221;
    const h = 0.22249159 * r1 + 0.71688604 * g1 + 0.060621485 * b1;
    const k = (0.013929122 * r1 + 0.097097 * g1 + 0.7141855 * b1) / 0.825211;
    const l =
        0.008856452 < h ? Math.pow(h, 1 / 3) : (903.2963 * h + 16.0) / 116.0;
    const m =
        500.0 *
        ((0.008856452 < f
            ? Math.pow(f, 1 / 3)
            : (903.2963 * f + 16.0) / 116.0) -
            l);
    const n =
        200.0 *
        (l -
            (0.008856452 < k
                ? Math.pow(k, 1 / 3)
                : (903.2963 * k + 16.0) / 116.0));

    const lab = [2.55 * (116.0 * l - 16.0) + 0.5, m + 0.5, n + 0.5];
    labCache.set(key, lab);
    return lab;
}

function distance(a, b, betterColour) {
    if (betterColour) {
        a = rgb2lab(a);
        b = rgb2lab(b);
    }
    const r = a[0] - b[0];
    const g = a[1] - b[1];
    const bl = a[2] - b[2];
    return r * r + g * g + bl * bl;
}

function buildPalette(selectedBlocks, toneKeys) {
    const palette = [];
    for (const [colourSetId, blockId] of Object.entries(selectedBlocks)) {
        if (blockId === "-1" || !(colourSetId in coloursJSON)) continue;
        for (const tone of toneKeys) {
            palette.push({
                colourSetId,
                tone,
                rgb: coloursJSON[colourSetId].tonesRGB[tone],
            });
        }
    }
    return palette;
}

function quantize(data, palette, betterColour) {
    const pixels = Buffer.from(data);
    const layout = new Array(pixels.length / 4);
    const cache = new Map();
    for (let i = 0; i < pixels.length; i += 4) {
        const pixel = [pixels[i], pixels[i + 1], pixels[i + 2]];
        const key = (pixel[0] << 16) + (pixel[1] << 8) + pixel[2];
        let closest = cache.get(key);
        if (!closest) {
            let best = Infinity;
            for (const entry of palette) {
                const d = distance(entry.rgb, pixel, betterColour);
                if (d < best) {
                    best = d;
                    closest = entry;
                }
            }
            cache.set(key, closest);
        }
        pixels[i] = closest.rgb[0];
        pixels[i + 1] = closest.rgb[1];
        pixels[i + 2] = closest.rgb[2];
        pixels[i + 3] = 255;
        layout[i / 4] = {
            colourSetId: closest.colourSetId,
            tone: closest.tone,
        };
    }
    return { pixels, layout };
}

function calculateMaterials(layout, selectedBlocks) {
    const counts = new Map();
    let totalBlocks = 0;

    for (const pixel of layout) {
        if (!pixel) continue;
        const { colourSetId } = pixel;
        const blockIndex = selectedBlocks[colourSetId];

        if (blockIndex === undefined || blockIndex === "-1") continue;

        const colourSet = coloursJSON[colourSetId];
        if (!colourSet || !colourSet.blocks || !colourSet.blocks[blockIndex])
            continue;

        const block = colourSet.blocks[blockIndex];
        const name =
            block.displayName || colourSet.colourName || "Unknown Block";

        if (!counts.has(name)) {
            counts.set(name, {
                name: name,
                colourSetId: colourSetId,
                blockIndex: blockIndex,
                count: 0,
            });
        }

        counts.get(name).count++;
        totalBlocks++;
    }

    const materials = Array.from(counts.values())
        .sort((a, b) => b.count - a.count)
        .map((item) => {
            const stacks = Math.floor(item.count / 64);
            const remainder = item.count % 64;
            const shulkers = (item.count / (27 * 64)).toFixed(1);

            return {
                name: item.name,
                count: item.count,
                percentage:
                    totalBlocks > 0
                        ? ((item.count / totalBlocks) * 100).toFixed(1) + "%"
                        : "0%",
                stacks:
                    stacks > 0 ? `${stacks}x64 + ${remainder}` : `${remainder}`,
                shulkerBoxes: parseFloat(shulkers),
            };
        });

    return { totalBlocks, materials };
}

function findClosest(pixel, palette, betterColour, cache) {
    const key = (pixel[0] << 16) + (pixel[1] << 8) + pixel[2];
    let closest = cache.get(key);
    if (!closest) {
        let best = Infinity;
        for (const entry of palette) {
            const d = distance(entry.rgb, pixel, betterColour);
            if (d < best) {
                best = d;
                closest = entry;
            }
        }
        cache.set(key, closest);
    }
    return closest;
}

function quantizeErrorDiffusion(
    data,
    width,
    height,
    palette,
    betterColour,
    method,
) {
    const { ditherMatrix, ditherDivisor } = method;
    const work = new Uint8ClampedArray(data);
    const layout = new Array(width * height);
    const cache = new Map();

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            const old = [work[i], work[i + 1], work[i + 2]];
            const closest = findClosest(old, palette, betterColour, cache);

            work[i] = closest.rgb[0];
            work[i + 1] = closest.rgb[1];
            work[i + 2] = closest.rgb[2];
            work[i + 3] = 255;
            layout[y * width + x] = {
                colourSetId: closest.colourSetId,
                tone: closest.tone,
            };

            const err = [
                old[0] - closest.rgb[0],
                old[1] - closest.rgb[1],
                old[2] - closest.rgb[2],
            ];

            for (let row = 0; row < ditherMatrix.length; row++) {
                for (let col = 0; col < ditherMatrix[row].length; col++) {
                    const weight = ditherMatrix[row][col] / ditherDivisor;
                    if (weight === 0) continue;
                    const nx = x + col - 2;
                    const ny = y + row;
                    if (nx < 0 || nx >= width || ny >= height) continue;
                    const j = (ny * width + nx) * 4;
                    work[j] += err[0] * weight;
                    work[j + 1] += err[1] * weight;
                    work[j + 2] += err[2] * weight;
                }
            }
        }
    }
    return { pixels: Buffer.from(work.buffer), layout };
}

function findClosestTwo(pixel, palette, betterColour, cache) {
    const key = (pixel[0] << 16) + (pixel[1] << 8) + pixel[2];
    let result = cache.get(key);
    if (result) return result;

    let d1 = Infinity;
    let d2 = Infinity;
    let c1 = null;
    let c2 = null;
    for (const entry of palette) {
        const d = distance(entry.rgb, pixel, betterColour);
        if (d < d1) {
            d2 = d1;
            c2 = c1;
            d1 = d;
            c1 = entry;
        } else if (d < d2) {
            d2 = d;
            c2 = entry;
        }
    }
    if (c2 === null || distance(c1.rgb, c2.rgb, betterColour) <= d2) {
        c2 = c1;
    }

    result = { d1, d2, c1, c2 };
    cache.set(key, result);
    return result;
}

function quantizeOrdered(data, width, height, palette, betterColour, method) {
    const matrix = method.ditherMatrix;
    const matrixW = matrix[0].length;
    const matrixH = matrix.length;
    const levels = matrixW * matrixH + 1;

    const pixels = Buffer.from(data);
    const layout = new Array(width * height);
    const cache = new Map();

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            const { d1, d2, c1, c2 } = findClosestTwo(
                [pixels[i], pixels[i + 1], pixels[i + 2]],
                palette,
                betterColour,
                cache,
            );

            const chosen =
                (d1 * levels) / d2 > matrix[x % matrixW][y % matrixH] ? c2 : c1;

            pixels[i] = chosen.rgb[0];
            pixels[i + 1] = chosen.rgb[1];
            pixels[i + 2] = chosen.rgb[2];
            pixels[i + 3] = 255;
            layout[y * width + x] = {
                colourSetId: chosen.colourSetId,
                tone: chosen.tone,
            };
        }
    }
    return { pixels, layout };
}

module.exports = {
    buildPalette,
    quantize,
    quantizeErrorDiffusion,
    quantizeOrdered,
    ditherMethods,
};
