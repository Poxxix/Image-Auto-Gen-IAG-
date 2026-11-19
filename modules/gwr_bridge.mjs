import fs from 'node:fs';
import { getEmbeddedAlphaMap } from '../vendor/gemini-watermark-remover/src/core/embeddedAlphaMaps.js';
import { computeRegionGradientCorrelation } from '../vendor/gemini-watermark-remover/src/core/adaptiveDetector.js';
import { removeWatermark } from '../vendor/gemini-watermark-remover/src/core/blendModes.js';
import { removeWatermarkFromImageDataSync } from '../vendor/gemini-watermark-remover/src/sdk/image-data.js';

function sampleAlphaSubpixel(alpha96, size, dx, dy, scale) {
    const out = new Float32Array(size * size);
    const s = (96 / size) / scale;
    const cx96 = 47.5;
    const cy96 = 47.5;
    const cx = (size - 1) / 2 + dx;
    const cy = (size - 1) / 2 + dy;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const sx = cx96 + (x - cx) * s;
            const sy = cy96 + (y - cy) * s;
            if (sx < 0 || sx >= 95 || sy < 0 || sy >= 95) continue;
            const x0 = Math.floor(sx);
            const y0 = Math.floor(sy);
            const wx = sx - x0;
            const wy = sy - y0;
            const p00 = alpha96[y0 * 96 + x0];
            const p10 = alpha96[y0 * 96 + x0 + 1];
            const p01 = alpha96[(y0 + 1) * 96 + x0];
            const p11 = alpha96[(y0 + 1) * 96 + x0 + 1];
            out[y * size + x] =
                (p00 * (1 - wx) + p10 * wx) * (1 - wy) +
                (p01 * (1 - wx) + p11 * wx) * wy;
        }
    }
    return out;
}

function edgeTotalVariation(img, pos, alphaMap) {
    const size = pos.width;
    const w = img.width;
    let tv = 0;
    for (let y = 1; y < size - 1; y++) {
        for (let x = 1; x < size - 1; x++) {
            const idx = y * size + x;
            const gxA = alphaMap[idx + 1] - alphaMap[idx - 1];
            const gyA = alphaMap[idx + size] - alphaMap[idx - size];
            const gA = Math.hypot(gxA, gyA);
            if (gA < 0.02) continue;
            const pR = ((pos.y + y) * w + (pos.x + x + 1)) * 4;
            const pL = ((pos.y + y) * w + (pos.x + x - 1)) * 4;
            const pD = ((pos.y + y + 1) * w + (pos.x + x)) * 4;
            const pU = ((pos.y + y - 1) * w + (pos.x + x)) * 4;
            for (let c = 0; c < 3; c++) {
                const gxI = img.data[pR + c] - img.data[pL + c];
                const gyI = img.data[pD + c] - img.data[pU + c];
                tv += Math.hypot(gxI, gyI) * gA;
            }
        }
    }
    return tv;
}

function directionalContourPolish(imageData, pos, alphaMap) {
    const size = pos.width;
    const w = imageData.width;
    const h = imageData.height;
    if (size < 16) return;

    const grad = new Float32Array(size * size);
    let maxGrad = 0;
    for (let y = 1; y < size - 1; y++) {
        for (let x = 1; x < size - 1; x++) {
            const idx = y * size + x;
            const g = Math.hypot(
                alphaMap[idx + 1] - alphaMap[idx - 1],
                alphaMap[idx + size] - alphaMap[idx - size]
            );
            grad[idx] = g;
            if (g > maxGrad) maxGrad = g;
        }
    }
    if (maxGrad <= 1e-5) return;

    const contourMask = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            let best = 0;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const ny = y + dy;
                    const nx = x + dx;
                    if (ny >= 0 && ny < size && nx >= 0 && nx < size) {
                        const r = grad[ny * size + nx] / maxGrad;
                        if (r > best) best = r;
                    }
                }
            }
            const a = alphaMap[y * size + x];
            if (best >= 0.08 || (a > 0.008 && a < 0.18)) {
                contourMask[y * size + x] = Math.min(
                    1,
                    Math.max(
                        (best - 0.07) / 0.28,
                        a > 0.008 && a < 0.18 ? 0.65 : 0
                    )
                );
            }
        }
    }

    for (let pass = 0; pass < 2; pass++) {
        const src = new Uint8ClampedArray(imageData.data);
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const cw = contourMask[y * size + x];
                if (cw <= 0.02) continue;
                const px = pos.x + x;
                const py = pos.y + y;
                if (px < 0 || px >= w || py < 0 || py >= h) continue;
                const cIdx = (py * w + px) * 4;

                let sR = 0;
                let sG = 0;
                let sB = 0;
                let sW = 0;
                for (let dy = -3; dy <= 3; dy++) {
                    for (let dx = -3; dx <= 3; dx++) {
                        if (dy < 0 || (dy === 0 && dx <= 0)) continue;
                        const dist = Math.hypot(dx, dy);
                        if (dist < 1.4 || dist > 3.2) continue;
                        const lx1 = x + dx;
                        const ly1 = y + dy;
                        const lx2 = x - dx;
                        const ly2 = y - dy;
                        const c1 =
                            lx1 >= 0 && lx1 < size && ly1 >= 0 && ly1 < size
                                ? contourMask[ly1 * size + lx1]
                                : 0;
                        const c2 =
                            lx2 >= 0 && lx2 < size && ly2 >= 0 && ly2 < size
                                ? contourMask[ly2 * size + lx2]
                                : 0;
                        if (c1 > 0.3 && c2 > 0.3) continue;

                        const p1x = Math.max(0, Math.min(w - 1, px + dx));
                        const p1y = Math.max(0, Math.min(h - 1, py + dy));
                        const p2x = Math.max(0, Math.min(w - 1, px - dx));
                        const p2y = Math.max(0, Math.min(h - 1, py - dy));
                        const i1 = (p1y * w + p1x) * 4;
                        const i2 = (p2y * w + p2x) * 4;
                        const diffSq =
                            ((src[i1] - src[i2]) ** 2 +
                                (src[i1 + 1] - src[i2 + 1]) ** 2 +
                                (src[i1 + 2] - src[i2 + 2]) ** 2) /
                            3;
                        const wIso = Math.exp(-diffSq / (2 * 16 * 16)) / dist;
                        if (c1 <= 0.3) {
                            const w1 = wIso * (1 - c1);
                            sR += src[i1] * w1;
                            sG += src[i1 + 1] * w1;
                            sB += src[i1 + 2] * w1;
                            sW += w1;
                        }
                        if (c2 <= 0.3) {
                            const w2 = wIso * (1 - c2);
                            sR += src[i2] * w2;
                            sG += src[i2 + 1] * w2;
                            sB += src[i2 + 2] * w2;
                            sW += w2;
                        }
                    }
                }
                if (sW > 0) {
                    const blend = pass === 0 ? cw * 0.85 : cw * 0.55;
                    imageData.data[cIdx] = Math.round(
                        src[cIdx] * (1 - blend) + (sR / sW) * blend
                    );
                    imageData.data[cIdx + 1] = Math.round(
                        src[cIdx + 1] * (1 - blend) + (sG / sW) * blend
                    );
                    imageData.data[cIdx + 2] = Math.round(
                        src[cIdx + 2] * (1 - blend) + (sB / sW) * blend
                    );
                }
            }
        }
    }
}

function main() {
    const input = fs.readFileSync(0);
    if (input.length < 8) {
        process.exit(2);
    }
    const width = input.readUInt32LE(0);
    const height = input.readUInt32LE(4);
    const expectedBytes = width * height * 4;
    if (input.length < 8 + expectedBytes) {
        process.exit(3);
    }

    const orig = new Uint8ClampedArray(
        input.buffer,
        input.byteOffset + 8,
        expectedBytes
    );
    const res = removeWatermarkFromImageDataSync({
        width,
        height,
        data: new Uint8ClampedArray(orig)
    });

    const meta = res.meta || {};
    const origSpatial = meta.detection?.originalSpatialScore ?? 0;
    const origGrad = meta.detection?.originalGradientScore ?? 0;
    const pos = meta.position;
    const marginRight = pos ? width - (pos.x + pos.width) : 0;
    const marginBottom = pos ? height - (pos.y + pos.height) : 0;
    const isAdaptiveSource =
        typeof meta.source === 'string' && meta.source.startsWith('adaptive');
    const minGrad = isAdaptiveSource ? 0.38 : 0.28;
    const minSpatial = isAdaptiveSource ? 0.38 : 0.32;

    if (
        !meta.applied ||
        !pos ||
        marginRight < 16 ||
        marginBottom < 16 ||
        origSpatial < minSpatial ||
        origGrad < minGrad ||
        origSpatial + origGrad < 0.68
    ) {
        process.stderr.write(
            JSON.stringify({
                applied: false,
                skipReason:
                    meta.skipReason ||
                    'already-clean-or-below-confidence-gate',
                origSpatial,
                origGrad
            })
        );
        process.stdout.write(Buffer.from(orig.buffer, orig.byteOffset, orig.byteLength));
        return;
    }

    const rawGain = Number.isFinite(meta.alphaGain) ? meta.alphaGain : 0.6;
    const baseGain = rawGain > 1.05 ? 0.6 : Math.max(0.45, rawGain);
    const isNativeSize = pos.width === 48 || pos.width === 96;

    // For downscaled preview sizes (e.g. 36px on 572x1024 or 43px on 825x1024)
    // or when residual edge gradient remains, run subpixel alignment + isophote contour polish
    if (!isNativeSize || (meta.passCount && meta.passCount > 1)) {
        const alpha96 = getEmbeddedAlphaMap(96);
        let bestScore = Infinity;
        let bestParams = { dx: 0, dy: 0, scale: 1, gain: baseGain };
        let bestAlpha = null;

        for (let dy = -1.0; dy <= 1.0; dy += 0.25) {
            for (let dx = -1.0; dx <= 1.0; dx += 0.25) {
                for (const scale of [0.97, 1.0, 1.03]) {
                    const candAlpha = sampleAlphaSubpixel(
                        alpha96,
                        pos.width,
                        dx,
                        dy,
                        scale
                    );
                    for (const gDelta of [-0.02, 0, 0.02]) {
                        const gain = Math.max(0.2, baseGain + gDelta);
                        const tmp = {
                            width,
                            height,
                            data: new Uint8ClampedArray(orig)
                        };
                        removeWatermark(tmp, candAlpha, pos, { alphaGain: gain });
                        const gradCorr = Math.abs(
                            computeRegionGradientCorrelation({
                                imageData: tmp,
                                alphaMap: candAlpha,
                                region: pos
                            })
                        );
                        const tv = edgeTotalVariation(tmp, pos, candAlpha);
                        const score = gradCorr * 4000 + tv;
                        if (score < bestScore) {
                            bestScore = score;
                            bestParams = { dx, dy, scale, gain, gradCorr };
                            bestAlpha = candAlpha;
                        }
                    }
                }
            }
        }

        const finalWork = {
            width,
            height,
            data: new Uint8ClampedArray(orig)
        };
        removeWatermark(finalWork, bestAlpha, pos, {
            alphaGain: bestParams.gain
        });
        directionalContourPolish(finalWork, pos, bestAlpha);

        process.stderr.write(
            JSON.stringify({
                applied: true,
                size: pos.width,
                position: pos,
                alphaGain: bestParams.gain,
                subpixel: {
                    dx: bestParams.dx,
                    dy: bestParams.dy,
                    scale: bestParams.scale
                },
                source: `${meta.source || 'gwr'}+subpixel-isophote`
            })
        );
        process.stdout.write(
            Buffer.from(
                finalWork.data.buffer,
                finalWork.data.byteOffset,
                finalWork.data.byteLength
            )
        );
        return;
    }

    // Native 48x48 / 96x96 single-pass clean output
    const alphaNative =
        pos.width === 48 ? getEmbeddedAlphaMap(48) : getEmbeddedAlphaMap(96);
    if (alphaNative) {
        directionalContourPolish(res.imageData, pos, alphaNative);
    }
    process.stderr.write(
        JSON.stringify({
            applied: true,
            size: meta.size,
            position: pos,
            alphaGain: meta.alphaGain,
            source: meta.source || 'gwr-native'
        })
    );
    process.stdout.write(
        Buffer.from(
            res.imageData.data.buffer,
            res.imageData.data.byteOffset,
            res.imageData.data.byteLength
        )
    );
}

main();
