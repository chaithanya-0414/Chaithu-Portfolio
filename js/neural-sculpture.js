/**
 * Neural sculpture — draws the hero's "neural filament" sculpture at runtime:
 * a twisting figure-eight bundle of fibres with glowing nodes, shaded like
 * warm metal, on a transparent canvas.
 *
 * Generated in the page (rather than loaded as an image) so the particle
 * engine can always read its pixels — even when the site is opened from disk.
 *
 * Usage: const canvas = NeuralSculpture.render()   // 2000 × 800
 */
(function () {
    "use strict";

    // small seeded PRNG so the sculpture is identical on every load
    function mulberry32(seed) {
        return function () {
            seed |= 0;
            seed = (seed + 0x6d2b79f5) | 0;
            let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    const lerp = (a, b, t) => a + (b - a) * t;
    const ss = (t) => {
        t = Math.max(0, Math.min(1, t));
        return t * t * (3 - 2 * t);
    };
    const mix = (c1, c2, t) => c1.map((v, i) => Math.round(lerp(v, c2[i], t)));

    const DEEP = [40, 18, 8];
    const BRONZE = [122, 58, 22];
    const AMBER = [242, 153, 74];
    const CREAM = [255, 228, 205];

    // metal ramp: deep shadow → bronze → amber → cream highlight
    function shade(lit) {
        if (lit < 0.4) return mix(DEEP, BRONZE, lit / 0.4);
        if (lit < 0.8) return mix(BRONZE, AMBER, (lit - 0.4) / 0.4);
        return mix(AMBER, CREAM, (lit - 0.8) / 0.2);
    }

    function spine(t) {
        const x = lerp(0.07, 0.93, t);
        const y = 0.5 + 0.13 * Math.sin(2 * Math.PI * (t * 0.9 + 0.1)) + 0.04 * Math.sin(2 * Math.PI * t * 2.3);
        return [x, y];
    }

    // swells in two lobes, pinched in the middle like a figure of eight
    function radius(t) {
        return 0.34 * Math.pow(Math.sin(Math.PI * t), 0.6) * (0.28 + 0.72 * Math.abs(Math.sin(2 * Math.PI * t)));
    }

    function render(opts) {
        const o = Object.assign({ width: 2000, height: 800, fibres: 320, steps: 240, seed: 7 }, opts);
        const W = o.width;
        const H = o.height;
        const rnd = mulberry32(o.seed);
        const canvas = document.createElement("canvas");
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext("2d");

        // segments are grouped into (depth, colour, width, alpha) buckets so the
        // whole sculpture strokes in a few hundred calls, back to front
        const DEPTH_BINS = 10;
        const LIT_BINS = 24;
        const buckets = new Map();
        const nodes = [];
        for (let i = 0; i < o.fibres; i++) {
            const th0 = rnd() * Math.PI * 2;
            const twist = (rnd() < 0.5 ? -1 : 1) * lerp(2.2, 3.4, rnd()) * Math.PI;
            const rr = lerp(0.55, 1, rnd());
            const wob = rnd() * Math.PI * 2;
            const t0 = rnd() * 0.12;
            const t1 = lerp(0.88, 1, rnd());
            let prev = null;
            for (let k = 0; k <= o.steps; k++) {
                const t = lerp(t0, t1, k / o.steps);
                const [cx, cy] = spine(t);
                const th = th0 + twist * t + 0.35 * Math.sin(6 * t + wob);
                const r = radius(t) * rr;
                const z = Math.sin(th);
                const px = (cx + r * Math.sin(th) * 0.1) * W;
                const py = (cy + r * Math.cos(th) * 0.9) * H;
                if (prev) {
                    // light from upper-front: front fibres and upward-facing ones catch it
                    const front = z * 0.5 + 0.5;
                    let lit = 0.05 + 0.6 * Math.pow(front, 1.6) + 0.3 * Math.max(0, -Math.cos(th)) * front;
                    if (z > 0.3) lit += 0.25 * Math.max(0, Math.sin(th * 3 + t * 9));
                    const fade = ss(Math.min(t - t0, t1 - t) / 0.05);
                    const db = Math.min(DEPTH_BINS - 1, Math.floor(front * DEPTH_BINS));
                    const lb = Math.min(LIT_BINS - 1, Math.floor(Math.min(1, lit) * LIT_BINS));
                    const fb = fade > 0.66 ? 2 : fade > 0.33 ? 1 : 0;
                    const key = db * 1000 + lb * 10 + fb;
                    let b = buckets.get(key);
                    if (!b) buckets.set(key, (b = { db, lb, fb, path: new Path2D() }));
                    b.path.moveTo(prev[0], prev[1]);
                    b.path.lineTo(px, py);
                }
                prev = [px, py];
                if (k % 18 === 0 && rnd() < 0.07 && z > 0.2) nodes.push([z, px, py]);
            }
        }

        ctx.lineCap = "round";
        const keys = [...buckets.keys()].sort((a, b) => a - b);
        for (const key of keys) {
            const { db, lb, fb, path } = buckets.get(key);
            const front = (db + 0.5) / DEPTH_BINS;
            const fade = (fb + 0.5) / 3;
            const [r, g, b] = shade((lb + 0.5) / LIT_BINS);
            ctx.strokeStyle = `rgba(${r},${g},${b},${fade * (0.3 + 0.7 * front)})`;
            ctx.lineWidth = 0.7 + 1.1 * front;
            ctx.stroke(path);
        }

        // neurons: small bright nodes with a soft halo, sitting on the fibres
        nodes.sort((a, b) => a[0] - b[0]);
        for (const [z, px, py] of nodes) {
            const r = lerp(2, 3.6, rnd()) * (0.7 + 0.3 * z) * 0.5;
            ctx.fillStyle = "rgba(242,153,74,0.27)";
            ctx.beginPath();
            ctx.arc(px, py, r * 2.2, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "rgb(255,228,205)";
            ctx.beginPath();
            ctx.arc(px, py, r, 0, Math.PI * 2);
            ctx.fill();
        }

        // dust: the spine continues past each tip, spreading as it goes
        const gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
        for (let i = 0; i < 700; i++) {
            const side = rnd() < 0.5;
            const u = -Math.log(1 - rnd()) * 0.05;
            const [cx, cy] = spine(side ? -u : 1 + u);
            const px = cx * W;
            const py = (cy + gauss() * (0.012 + u * 0.5)) * H;
            if (px < 0 || px > W) continue;
            ctx.fillStyle = `rgba(242,153,74,${lerp(0.25, 0.8, rnd()) * Math.exp(-u * 12)})`;
            ctx.beginPath();
            ctx.arc(px, py, lerp(0.4, 0.9, rnd()), 0, Math.PI * 2);
            ctx.fill();
        }

        // soft warm bloom underneath (skipped where canvas filters are unsupported)
        if ("filter" in ctx) {
            const bloom = document.createElement("canvas");
            bloom.width = W;
            bloom.height = H;
            const b = bloom.getContext("2d");
            b.filter = "blur(10px)";
            b.drawImage(canvas, 0, 0);
            b.filter = "none";
            b.globalCompositeOperation = "source-in";
            b.fillStyle = "rgba(242,153,74,0.35)";
            b.fillRect(0, 0, W, H);
            b.globalCompositeOperation = "source-over";
            b.drawImage(canvas, 0, 0);
            return bloom;
        }
        return canvas;
    }

    window.NeuralSculpture = { render };
})();
