/**
 * Liquid sculpture — WebGL2 GPGPU particle hero.
 *
 * Vanilla port of "Sculpture Hero" by guglielmogiannattasio.it.
 * The sculpture is rebuilt from GPU-simulated particles sampled from its own
 * pixels. The cursor turns the material liquid; it settles back into the
 * crisp image, and while nobody is interacting a slow idle drift keeps it
 * flowing. Without WebGL2 the static sculpture is shown instead.
 *
 * Usage:
 *   const hero = LiquidHero.mount(rootEl, { source: canvas })
 *   hero.start()   // play the assembly intro once the page is ready
 */
(function () {
    "use strict";

    function clamp(v, a, b) {
        return Math.min(b, Math.max(a, v));
    }

    /* ── shaders ─────────────────────────────────────────────────────── */

    const NOISE = `
float hash(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); vec2 u=f*f*f*(f*(f*6.0-15.0)+10.0);
  return mix(mix(hash(i),hash(i+vec2(1.0,0.0)),u.x), mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0,1.0)),u.x), u.y); }
vec2 ambientField(vec2 uv, float t){
  vec2 q = uv*vec2(3.2,1.7);
  vec2 a = vec2(vnoise(q+vec2(t*0.11,0.0))-0.5, vnoise(q+vec2(5.2,t*0.08)+3.1)-0.5);
  vec2 q2 = uv*vec2(7.5,4.0) + vec2(-t*0.19, t*0.13);
  vec2 b = vec2(vnoise(q2+1.7)-0.5, vnoise(q2+9.3)-0.5);
  return a + b*0.45;
}
`;

    // energy of the material at a point: shared by image and particles so the
    // cross-fade is exactly complementary
    const ENERGY = `
float energyAt(vec2 rectPx, vec2 mouse, float radius, float presence, float wakeEnergy){
  vec2 d = rectPx - mouse;
  float f = exp(-dot(d,d)/(radius*radius))*presence;
  return smoothstep(0.06, 0.5, f*1.15 + wakeEnergy*1.7);
}
`;

    const QUAD_VS = `#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vUv;
void main(){ vUv = aPos*0.5+0.5; gl_Position = vec4(aPos,0.0,1.0); }
`;

    // flow map (cursor wake). RGBA8: velocity encoded around 128, energy in B
    const FLOW_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uPrev;
uniform vec2 uTexel;
uniform vec2 uMouse;
uniform vec2 uVel;
uniform vec2 uSize;
uniform float uRadius;
uniform float uPresence;
uniform float uDecay;
vec2 decV(vec4 c){ return (c.rg*255.0-128.0)/127.0; }
void main(){
  vec2 v0 = decV(texture(uPrev, vUv));
  vec2 uv = vUv - v0*uTexel*2.5;
  vec4 c = texture(uPrev, uv)*0.52
    + 0.12*(texture(uPrev, uv+vec2(uTexel.x,0.0)) + texture(uPrev, uv-vec2(uTexel.x,0.0))
          + texture(uPrev, uv+vec2(0.0,uTexel.y)) + texture(uPrev, uv-vec2(0.0,uTexel.y)));
  vec2 v = decV(c);
  float p = c.b;
  vec2 d = (vUv-uMouse)*uSize;
  float f = exp(-dot(d,d)/(uRadius*uRadius))*uPresence;
  float sp = clamp(length(uVel)*2.5, 0.0, 1.0);
  v += uVel*f*0.22;
  p = max(p, f*sp);
  v *= uDecay;
  p *= uDecay;
  v = sign(v)*max(abs(v)-1.2/127.0, 0.0);
  p = max(p-1.2/255.0, 0.0);
  v = clamp(v, -1.0, 1.0);
  o = vec4((v*127.0+128.0)/255.0, p, 1.0);
}
`;

    // GPGPU step: state = (offset.xy, velocity.xy) in rect CSS px
    const SIM_FS = `#version 300 es
precision highp float;
out vec4 o;
uniform sampler2D uState;
uniform sampler2D uHome;
uniform sampler2D uFlow;
uniform vec2 uSize;
uniform vec2 uMouse;
uniform float uRadius;
uniform float uPresence;
uniform float uStrength;
uniform float uSpread;
uniform float uTurb;
uniform float uReturn;
uniform float uTime;
uniform float uDt;
uniform float uIntro;
${NOISE}
vec2 curl(vec2 p){
  const float e = 0.35;
  float a = vnoise(p+vec2(0.0,e)) - vnoise(p-vec2(0.0,e));
  float b = vnoise(p+vec2(e,0.0)) - vnoise(p-vec2(e,0.0));
  return vec2(a, -b)/(2.0*e);
}
void main(){
  ivec2 ij = ivec2(gl_FragCoord.xy);
  vec4 hm = texelFetch(uHome, ij, 0);
  if(hm.w <= 0.0){ o = vec4(0.0); return; }
  vec4 st = texelFetch(uState, ij, 0);
  vec2 off = st.xy;
  vec2 vel = st.zw;
  float sd = hm.z;
  float light = 0.45 + sd*1.1;

  vec2 p = hm.xy*uSize + off;
  vec4 fl = texture(uFlow, clamp(p/uSize, 0.0, 1.0));
  vec2 wake = (fl.rg*255.0-128.0)/127.0;
  float pr = fl.b;

  vec2 toM = p - uMouse;
  float r2 = dot(toM,toM);
  float f = exp(-r2/(uRadius*uRadius))*uPresence;
  vec2 n = toM*inversesqrt(r2+1.0);
  float e = clamp(pr*2.0 + f, 0.0, 1.0);

  vec2 acc = vec2(0.0);
  acc += n*f*1.25*uStrength*uSpread*light;
  acc += vec2(-n.y, n.x)*f*1.45*uStrength*uSpread*(0.4+sd);
  acc += (wake*42.0*uSpread*light - vel)*e*0.08;
  vec2 q = p*0.0095 + vec2(uTime*0.35, -uTime*0.2);
  vec2 c = curl(q) + 0.5*curl(q*2.3 + 7.1);
  acc += c*(e*1.2*uSpread + uIntro*1.5)*uTurb*light;
  float k = (0.006 + 0.02*uReturn)*(0.65+sd*0.7)*(1.0 - uIntro*0.75);
  acc -= off*k;

  vel += acc*uDt;
  vel *= pow(mix(0.93, 0.955, e), uDt);
  off += vel*uDt;
  if(dot(off,off) < 0.0004 && dot(vel,vel) < 0.0004){ off = vec2(0.0); vel = vec2(0.0); }
  o = vec4(off, vel);
}
`;

    // particles: one instanced quad per particle, a capsule stretched along velocity
    const PART_VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;
uniform sampler2D uState;
uniform sampler2D uHome;
uniform sampler2D uCol;
uniform sampler2D uFlow;
uniform int uTexW;
uniform vec4 uRect;
uniform vec2 uRes;
uniform vec2 uMouse;
uniform float uRadius;
uniform float uPresence;
uniform float uDot;
uniform float uTime;
uniform float uAmbient;
uniform float uStreak;
uniform float uIntroVis;
uniform float uRest;
out vec2 vLocal;
out float vHalfLen;
out float vR;
out vec3 vCol;
out float vA;
${NOISE}
${ENERGY}
void main(){
  int id = gl_InstanceID;
  ivec2 ij = ivec2(id % uTexW, id / uTexW);
  vec4 hm = texelFetch(uHome, ij, 0);
  vec4 st = texelFetch(uState, ij, 0);
  vec4 cl = texelFetch(uCol, ij, 0);

  float wakeE = texture(uFlow, hm.xy).b;
  float E = energyAt(hm.xy*uRect.zw, uMouse, uRadius, uPresence, wakeE);
  float lift = smoothstep(0.35, 2.5, length(st.xy));
  float a = max(max(E, lift), max(uRest, 1.0-uIntroVis));
  if(a < 0.01 || hm.w <= 0.0){ gl_Position = vec4(2.0,2.0,2.0,1.0); return; }

  vec2 base = uRect.xy + hm.xy*uRect.zw + st.xy;
  base -= ambientField(hm.xy, uTime)*10.0*uAmbient;

  vec2 v = st.zw;
  float sp = length(v);
  vec2 dir = sp > 0.001 ? v/sp : vec2(1.0,0.0);
  float r = uDot*hm.w*0.5;
  float len = min(sp*1.25, 18.0)*uStreak;
  vec2 lc = aCorner*vec2(r + len*0.5 + 1.0, r + 1.0);
  vec2 center = base - dir*len*0.5;
  vec2 world = center + dir*lc.x + vec2(-dir.y, dir.x)*lc.y;

  vec2 clip = world/uRes*2.0-1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  vLocal = lc;
  vHalfLen = len*0.5;
  vR = r;
  vec3 col = cl.rgb;
  // fast material catches the light, like liquid metal (warm amber glint)
  float glint = smoothstep(2.0, 16.0, sp);
  col = mix(col, min(col*1.2 + vec3(0.10,0.07,0.04), vec3(1.0)), glint*0.75);
  vCol = col;
  vA = a*cl.a;
}
`;

    const PART_FS = `#version 300 es
precision highp float;
in vec2 vLocal;
in float vHalfLen;
in float vR;
in vec3 vCol;
in float vA;
uniform float uDpr;
out vec4 o;
void main(){
  vec2 q = vec2(max(abs(vLocal.x)-vHalfLen, 0.0), vLocal.y);
  float d = length(q) - vR;
  float a = clamp(0.5 - d*uDpr, 0.0, 1.0);
  float tail = vHalfLen > 0.0 ? clamp(0.5 - vLocal.x/(2.0*(vHalfLen+vR)), 0.0, 1.0) : 0.0;
  a *= 1.0 - tail*0.55;
  a *= vA;
  if(a < 0.004) discard;
  o = vec4(vCol*a, a);
}
`;

    // image pass: the crisp sculpture, gently lensed, fading out where the
    // material has turned liquid
    const IMAGE_FS = `#version 300 es
precision highp float;
out vec4 o;
uniform sampler2D uImg;
uniform sampler2D uFlow;
uniform vec2 uRes;
uniform float uDpr;
uniform vec4 uRect;
uniform vec2 uMouse;
uniform float uPresence;
uniform float uRadius;
uniform float uStrength;
uniform float uTime;
uniform float uAmbient;
uniform float uIntroVis;
uniform float uRest;
${NOISE}
${ENERGY}
void main(){
  vec2 px = vec2(gl_FragCoord.x, uRes.y*uDpr - gl_FragCoord.y)/uDpr;
  vec2 size = uRect.zw;
  vec2 uv = (px-uRect.xy)/size;
  if(uv.x < -0.05 || uv.x > 1.05 || uv.y < -0.12 || uv.y > 1.12){ o = vec4(0.0); return; }
  vec4 fl = texture(uFlow, clamp(uv,0.0,1.0));
  vec2 vel = (fl.rg*255.0-128.0)/127.0;
  vec2 rp = uv*size;
  vec2 toM = rp - uMouse;
  float fall = exp(-dot(toM,toM)/(uRadius*uRadius))*uPresence;
  vec2 disp = -toM*0.22*uStrength*fall - vel*10.0*uStrength;
  disp += ambientField(uv, uTime)*10.0*uAmbient;
  vec2 suv = uv + disp/size;
  vec4 tx = texture(uImg, suv);
  vec2 e = smoothstep(vec2(0.0), vec2(0.004,0.01), suv) * smoothstep(vec2(1.0), vec2(0.996,0.99), suv);
  float k = tx.a*e.x*e.y;
  float E = energyAt(rp, uMouse, uRadius, uPresence, fl.b);
  float show = (1.0 - max(E, uRest))*uIntroVis;
  float A = k*show;
  o = vec4(tx.rgb*A, A);
}
`;

    /* ── helpers ─────────────────────────────────────────────────────── */

    function compile(gl, vs, fs) {
        const make = (type, src) => {
            const sh = gl.createShader(type);
            gl.shaderSource(sh, src);
            gl.compileShader(sh);
            if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
                const log = gl.getShaderInfoLog(sh);
                gl.deleteShader(sh);
                throw new Error("Shader: " + log);
            }
            return sh;
        };
        const p = gl.createProgram();
        const v = make(gl.VERTEX_SHADER, vs);
        const f = make(gl.FRAGMENT_SHADER, fs);
        gl.attachShader(p, v);
        gl.attachShader(p, f);
        gl.bindAttribLocation(p, 0, "aPos");
        gl.linkProgram(p);
        gl.deleteShader(v);
        gl.deleteShader(f);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error("Link: " + gl.getProgramInfoLog(p));
        const u = {};
        const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
        for (let i = 0; i < n; i++) {
            const info = gl.getActiveUniform(p, i);
            if (info) u[info.name] = gl.getUniformLocation(p, info.name);
        }
        return { p, u };
    }

    /* ── engine ──────────────────────────────────────────────────────── */

    const TEX_W = 1024;
    const SETTLE_FRAMES = 270;

    class LiquidEngine {
        constructor(canvas, opts, onFail) {
            this.canvas = canvas;
            this.opts = opts;
            this.onFail = onFail;
            this.onFirstFrame = null;

            this.flowTex = [];
            this.flowFb = [];
            this.flowW = 160;
            this.flowH = 280;
            this.flowIdx = 0;
            this.flowDirty = false;

            this.imgTex = null;
            this.homeTex = null;
            this.colTex = null;
            this.homeData = null;
            this.stateTex = [];
            this.stateFb = [];
            this.stateIdx = 0;
            this.texH = 1;
            this.n = 0;
            this.gridW = 1;
            this.stateDirty = false;
            this.flowing = 0;

            this.aspect = 0.58;
            this.rect = { x: 0, y: 0, w: 1, h: 1 };
            this.cssW = 1;
            this.cssH = 1;

            this.target = { x: -9999, y: -9999 };
            this.mouse = { x: -9999, y: -9999 };
            this.prevMouse = { x: -9999, y: -9999 };
            this.mvel = { x: 0, y: 0 };
            this.presence = 0;
            this.presenceTarget = 0;
            this.burst = 0;
            this.settle = 1e9;
            this.touchRelease = 0;
            this.lastInput = -1e9;

            this.time = 0;
            this.introT = 1;
            this.raf = 0;
            this.running = false;
            this.last = 0;
            this.skip = 0;
            this.visible = true;
            this.ready = false;
            this.destroyed = false;
            this.lost = false;

            const gl = canvas.getContext("webgl2", {
                alpha: true,
                antialias: false,
                depth: false,
                stencil: false,
                premultipliedAlpha: true,
                preserveDrawingBuffer: false,
                powerPreference: "high-performance",
            });
            if (!gl) throw new Error("WebGL2 unavailable");
            this.gl = gl;
            this.lowPower =
                (navigator.hardwareConcurrency || 8) <= 4 ||
                (navigator.deviceMemory || 8) <= 4 ||
                window.matchMedia("(pointer: coarse)").matches;

            this.onLost = (e) => {
                e.preventDefault();
                this.lost = true;
                this.stop();
                this.onFail();
            };
            this.frame = this.frame.bind(this);
            this.initGL();
            canvas.addEventListener("webglcontextlost", this.onLost, false);
        }

        initGL() {
            const gl = this.gl;
            const full = gl.getExtension("EXT_color_buffer_float");
            const half = full ? null : gl.getExtension("EXT_color_buffer_half_float");
            if (!full && !half) throw new Error("No float render targets");
            this.stateFormat = { internal: gl.RGBA16F, type: gl.HALF_FLOAT };

            this.pFlow = compile(gl, QUAD_VS, FLOW_FS);
            this.pSim = compile(gl, QUAD_VS, SIM_FS);
            this.pPart = compile(gl, PART_VS, PART_FS);
            this.pImg = compile(gl, QUAD_VS, IMAGE_FS);

            this.vao = gl.createVertexArray();
            gl.bindVertexArray(this.vao);
            this.quad = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
            gl.enableVertexAttribArray(0);
            gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

            for (let i = 0; i < 2; i++) {
                const t = this.makeTex(gl.RGBA8, this.flowW, this.flowH, gl.RGBA, gl.UNSIGNED_BYTE, null, gl.LINEAR);
                const fb = gl.createFramebuffer();
                gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
                gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
                this.flowTex.push(t);
                this.flowFb.push(fb);
            }
            this.clearFlow();
        }

        makeTex(internal, w, h, format, type, data, filter) {
            const gl = this.gl;
            const t = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, t);
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
            gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            return t;
        }

        clearFlow() {
            const gl = this.gl;
            for (const fb of this.flowFb) {
                gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
                gl.viewport(0, 0, this.flowW, this.flowH);
                gl.clearColor(128 / 255, 128 / 255, 0, 1);
                gl.clear(gl.COLOR_BUFFER_BIT);
            }
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            this.flowDirty = false;
        }

        clearState() {
            const gl = this.gl;
            for (const fb of this.stateFb) {
                gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
                gl.viewport(0, 0, TEX_W, this.texH);
                gl.clearColor(0, 0, 0, 0);
                gl.clear(gl.COLOR_BUFFER_BIT);
            }
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            this.stateDirty = false;
        }

        setImage(img) {
            if (this.destroyed || this.lost) return;
            const gl = this.gl;
            this.aspect = (img.naturalWidth || img.width) / (img.naturalHeight || img.height) || this.aspect;
            // the flow map follows the image's aspect, ~45k cells
            this.flowW = Math.max(32, Math.round(Math.sqrt(45000 * this.aspect)));
            this.flowH = Math.max(32, Math.round(this.flowW / this.aspect));
            for (const t of this.flowTex) {
                gl.bindTexture(gl.TEXTURE_2D, t);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.flowW, this.flowH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            }
            this.clearFlow();
            if (this.imgTex) gl.deleteTexture(this.imgTex);
            this.imgTex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, this.imgTex);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
            gl.generateMipmap(gl.TEXTURE_2D);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            this.buildParticles(img);
            this.ready = true;
            if (this.opts.intro && !this.opts.reducedMotion) this.startIntro();
            this.wake();
        }

        // one particle per opaque pixel of a grid laid over the image
        buildParticles(img) {
            const gl = this.gl;
            // grid sized by area so portrait and landscape images cost the same
            const cells = (this.lowPower ? 90000 : 200000) * clamp(this.opts.density, 0.15, 2);
            const gw = Math.max(1, Math.round(Math.sqrt(cells * this.aspect)));
            const gh = Math.max(1, Math.round(gw / this.aspect));
            this.gridW = gw;
            let data;
            try {
                const c = document.createElement("canvas");
                c.width = gw;
                c.height = gh;
                const ctx = c.getContext("2d", { willReadFrequently: true });
                ctx.imageSmoothingQuality = "high";
                ctx.drawImage(img, 0, 0, gw, gh);
                data = ctx.getImageData(0, 0, gw, gh).data;
            } catch (err) {
                throw new Error("Image is not CORS-readable");
            }
            const home = [];
            const col = [];
            for (let y = 0; y < gh; y++) {
                for (let x = 0; x < gw; x++) {
                    const i = (y * gw + x) * 4;
                    const a = data[i + 3] / 255;
                    if (a < 0.08) continue;
                    if (a < 0.5 && Math.random() > a * 2) continue;
                    const jx = (Math.random() - 0.5) * 0.6;
                    const jy = (Math.random() - 0.5) * 0.6;
                    home.push((x + 0.5 + jx) / gw, (y + 0.5 + jy) / gh, Math.random(), 0.85 + Math.random() * 0.3);
                    col.push(data[i], data[i + 1], data[i + 2], Math.round(Math.max(a, 0.5) * 255));
                }
            }
            const n = home.length / 4;
            this.n = n;
            this.texH = Math.max(1, Math.ceil(n / TEX_W));
            const total = TEX_W * this.texH;
            const homeArr = new Float32Array(total * 4);
            homeArr.set(home);
            const colArr = new Uint8Array(total * 4);
            colArr.set(col);

            for (const t of [this.homeTex, this.colTex, ...this.stateTex]) if (t) gl.deleteTexture(t);
            for (const f of this.stateFb) gl.deleteFramebuffer(f);
            this.stateTex = [];
            this.stateFb = [];
            this.homeTex = this.makeTex(gl.RGBA32F, TEX_W, this.texH, gl.RGBA, gl.FLOAT, homeArr, gl.NEAREST);
            this.colTex = this.makeTex(gl.RGBA8, TEX_W, this.texH, gl.RGBA, gl.UNSIGNED_BYTE, colArr, gl.NEAREST);
            for (let i = 0; i < 2; i++) {
                const t = this.makeTex(this.stateFormat.internal, TEX_W, this.texH, gl.RGBA, this.stateFormat.type, null, gl.NEAREST);
                const fb = gl.createFramebuffer();
                gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
                gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
                if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("Float FBO incomplete");
                this.stateTex.push(t);
                this.stateFb.push(fb);
            }
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            this.homeData = homeArr;
            this.clearState();
        }

        // scatter every particle away from home; the sim pulls them back in
        startIntro() {
            const gl = this.gl;
            const home = this.homeData;
            if (!home) return;
            const w = this.rect.w > 10 ? this.rect.w : 500;
            const h = this.rect.h > 10 ? this.rect.h : 860;
            const total = TEX_W * this.texH;
            const st = new Float32Array(total * 4);
            for (let i = 0; i < this.n; i++) {
                const hx = home[i * 4] - 0.5;
                const hy = home[i * 4 + 1] - 0.5;
                const sd = home[i * 4 + 2];
                const ang = Math.atan2(hy, hx) + (Math.random() - 0.5) * 1.4;
                const dist = (w + h) * 0.5 * (0.08 + Math.random() * 0.3) * (0.4 + Math.hypot(hx, hy) * 1.6);
                st[i * 4] = Math.cos(ang) * dist + hx * w * 0.3 * sd;
                st[i * 4 + 1] = Math.sin(ang) * dist * 0.8 + 140 * (Math.random() - 0.5);
            }
            gl.bindTexture(gl.TEXTURE_2D, this.stateTex[this.stateIdx]);
            gl.texImage2D(gl.TEXTURE_2D, 0, this.stateFormat.internal, TEX_W, this.texH, 0, gl.RGBA, gl.FLOAT, st);
            this.introT = 0;
            this.stateDirty = true;
        }

        setOptions(o) {
            this.opts = Object.assign({}, this.opts, o);
            this.wake();
        }

        resize(cssW, cssH, rect) {
            this.cssW = Math.max(1, cssW);
            this.cssH = Math.max(1, cssH);
            this.rect = rect;
            let dpr = Math.min(window.devicePixelRatio || 1, this.lowPower ? 1.5 : 2);
            const px = this.cssW * this.cssH * dpr * dpr;
            if (px > 4.5e6) dpr = Math.max(1, Math.sqrt(4.5e6 / (this.cssW * this.cssH)));
            const w = Math.round(this.cssW * dpr);
            const h = Math.round(this.cssH * dpr);
            if (this.canvas.width !== w || this.canvas.height !== h) {
                this.canvas.width = w;
                this.canvas.height = h;
            }
            this.draw();
        }

        setVisible(v) {
            this.visible = v;
            if (v) this.wake();
            else this.stop();
        }

        pointer(type, x, y, touch) {
            if (!this.opts.interactive || this.lost) return;
            const now = performance.now();
            this.lastInput = now;
            if (type === "leave" || type === "up") {
                if (touch) this.touchRelease = now + 260;
                else this.presenceTarget = 0;
                this.wake();
                return;
            }
            if (this.mouse.x < -9000 || type === "down") {
                this.mouse.x = this.prevMouse.x = x;
                this.mouse.y = this.prevMouse.y = y;
            }
            this.target.x = x;
            this.target.y = y;
            this.presenceTarget = 1;
            this.settle = 0;
            if (type === "down") {
                this.burst = 1;
                this.touchRelease = 0;
            }
            this.wake();
        }

        wake() {
            if (!this.ready || this.running || !this.visible || this.destroyed || this.lost) {
                if (this.ready && !this.running) this.draw();
                return;
            }
            this.running = true;
            this.last = performance.now();
            this.raf = requestAnimationFrame(this.frame);
        }

        stop() {
            this.running = false;
            cancelAnimationFrame(this.raf);
        }

        radiusPx() {
            return this.opts.radius * clamp(this.rect.w / 1400, 0.6, 1.25);
        }

        strength() {
            return this.opts.strength * (this.opts.reducedMotion ? 0.5 : 1);
        }

        frame(now) {
            if (!this.running) return;
            // a rAF timestamp can precede the performance.now() taken in wake()
            const rawMs = Math.max(0, now - this.last);
            const dt = clamp(rawMs / 16.6667, 0.25, 3);
            this.last = now;
            const o = this.opts;
            const ambientOn = o.ambient && !o.reducedMotion;

            if (this.touchRelease && now > this.touchRelease) {
                this.presenceTarget = 0;
                this.touchRelease = 0;
            }
            // idle drift: with nobody at the controls, a slow invisible cursor keeps
            // stirring the material, so the hero is never a still picture
            if (o.autoplay && !o.reducedMotion && !this.lowPower && this.introT >= 1 && now - this.lastInput > 2500) {
                const t = now / 1000;
                const r = this.rect;
                this.target.x = r.x + r.w * (0.5 + 0.4 * Math.sin(t * 0.21));
                this.target.y = r.y + r.h * (0.5 + 0.22 * Math.sin(t * 0.43 + 1.3));
                if (this.mouse.x < -9000) {
                    this.mouse.x = this.prevMouse.x = this.target.x;
                    this.mouse.y = this.prevMouse.y = this.target.y;
                }
                this.presenceTarget = 0.55;
            }
            const ease = 1 - Math.pow(1 - 0.22, dt);
            this.mouse.x += (this.target.x - this.mouse.x) * ease;
            this.mouse.y += (this.target.y - this.mouse.y) * ease;
            const vx = (this.mouse.x - this.prevMouse.x) / dt;
            const vy = (this.mouse.y - this.prevMouse.y) / dt;
            this.prevMouse.x = this.mouse.x;
            this.prevMouse.y = this.mouse.y;
            this.mvel.x += (clamp(vx, -60, 60) - this.mvel.x) * 0.5;
            this.mvel.y += (clamp(vy, -60, 60) - this.mvel.y) * 0.5;
            const pk = this.presenceTarget > this.presence ? 0.1 : 0.035;
            this.presence += (this.presenceTarget - this.presence) * (1 - Math.pow(1 - pk, dt));
            if (this.presence < 0.001 && this.presenceTarget === 0) this.presence = 0;
            const fk = this.presenceTarget > this.flowing ? 0.05 : 0.018;
            this.flowing += (this.presenceTarget - this.flowing) * (1 - Math.pow(1 - fk, dt));
            if (this.flowing < 0.002 && this.presenceTarget === 0) this.flowing = 0;
            if (this.introT < 1) this.introT = Math.min(1, this.introT + Math.min(rawMs, 100) / 3000);

            const interacting = this.presence > 0.001 || this.burst > 0;
            // settle is counted in simulated frames, so slow devices never snap mid-return
            this.settle = interacting ? 0 : this.settle + dt;
            const active = interacting || this.settle < SETTLE_FRAMES || this.introT < 1;

            if (!active) {
                if (this.flowDirty) this.clearFlow();
                if (this.stateDirty) this.clearState();
                if (!ambientOn) {
                    this.draw();
                    this.firstFrame();
                    this.stop();
                    return;
                }
                this.raf = requestAnimationFrame(this.frame);
                if (this.skip++ % 2) return;
                this.time += (dt * 2 * o.speed) / 60;
                this.draw();
                this.firstFrame();
                return;
            }
            this.raf = requestAnimationFrame(this.frame);
            // the field speeds up while the material is being stirred
            this.time += (dt * o.speed * (1 + this.flowing * 1.6)) / 60;
            this.stepFlow(dt);
            this.stepSim(dt);
            this.burst = Math.max(0, this.burst - 0.1 * dt);
            this.draw();
            this.firstFrame();
        }

        firstFrame() {
            if (this.onFirstFrame) {
                const cb = this.onFirstFrame;
                this.onFirstFrame = null;
                requestAnimationFrame(() => cb());
            }
        }

        stepFlow(dt) {
            const gl = this.gl;
            const P = this.pFlow;
            const dst = 1 - this.flowIdx;
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.flowFb[dst]);
            gl.viewport(0, 0, this.flowW, this.flowH);
            gl.disable(gl.BLEND);
            gl.useProgram(P.p);
            gl.bindVertexArray(this.vao);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.flowTex[this.flowIdx]);
            gl.uniform1i(P.u.uPrev, 0);
            gl.uniform2f(P.u.uTexel, 1 / this.flowW, 1 / this.flowH);
            const r = this.rect;
            gl.uniform2f(P.u.uMouse, (this.mouse.x - r.x) / r.w, (this.mouse.y - r.y) / r.h);
            gl.uniform2f(P.u.uVel, clamp(this.mvel.x / 40, -1, 1), clamp(this.mvel.y / 40, -1, 1));
            gl.uniform2f(P.u.uSize, r.w, r.h);
            gl.uniform1f(P.u.uRadius, this.radiusPx());
            gl.uniform1f(P.u.uPresence, Math.max(this.presence, this.burst));
            gl.uniform1f(P.u.uDecay, Math.pow(0.968, dt));
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            this.flowIdx = dst;
            this.flowDirty = true;
        }

        stepSim(dt) {
            if (!this.n) return;
            const gl = this.gl;
            const P = this.pSim;
            const o = this.opts;
            const r = this.rect;
            const dst = 1 - this.stateIdx;
            const intro = o.reducedMotion || !o.intro ? 0 : Math.pow(1 - this.introT, 2);
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.stateFb[dst]);
            gl.viewport(0, 0, TEX_W, this.texH);
            gl.disable(gl.BLEND);
            gl.useProgram(P.p);
            gl.bindVertexArray(this.vao);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.stateTex[this.stateIdx]);
            gl.uniform1i(P.u.uState, 0);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, this.homeTex);
            gl.uniform1i(P.u.uHome, 1);
            gl.activeTexture(gl.TEXTURE2);
            gl.bindTexture(gl.TEXTURE_2D, this.flowTex[this.flowIdx]);
            gl.uniform1i(P.u.uFlow, 2);
            gl.uniform2f(P.u.uSize, r.w, r.h);
            gl.uniform2f(P.u.uMouse, this.mouse.x - r.x, this.mouse.y - r.y);
            gl.uniform1f(P.u.uRadius, this.radiusPx());
            gl.uniform1f(P.u.uPresence, Math.max(this.presence, this.burst));
            gl.uniform1f(P.u.uStrength, this.strength() * (1 + this.burst * 1.5));
            gl.uniform1f(P.u.uSpread, clamp(o.spread, 0, 2));
            gl.uniform1f(P.u.uTurb, clamp(o.turbulence, 0, 2) * (o.reducedMotion ? 0.3 : 1));
            gl.uniform1f(P.u.uReturn, clamp(o.returnSpeed, 0, 2));
            gl.uniform1f(P.u.uTime, this.time);
            gl.uniform1f(P.u.uDt, dt);
            gl.uniform1f(P.u.uIntro, intro);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            this.stateIdx = dst;
            this.stateDirty = true;
        }

        draw() {
            if (!this.ready || this.lost || this.destroyed) return;
            const gl = this.gl;
            const o = this.opts;
            const r = this.rect;
            const rm = o.reducedMotion;
            const introVis = rm || !o.intro ? 1 : Math.pow(this.introT, 2.2);
            const base = o.ambient && !rm ? clamp(o.ambientIntensity, 0, 2) : 0;
            const amb = base + this.flowing * 0.85 * clamp(o.liquid, 0, 2) * (rm ? 0.3 : 1);
            const rest = o.restStyle === "particles" ? 1 : 0;
            const dpr = this.canvas.width / this.cssW;
            const pres = Math.max(this.presence, this.burst);
            const mx = this.mouse.x - r.x;
            const my = this.mouse.y - r.y;

            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.viewport(0, 0, this.canvas.width, this.canvas.height);
            gl.bindVertexArray(this.vao);
            gl.disable(gl.BLEND);

            const I = this.pImg;
            gl.useProgram(I.p);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.imgTex);
            gl.uniform1i(I.u.uImg, 0);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, this.flowTex[this.flowIdx]);
            gl.uniform1i(I.u.uFlow, 1);
            gl.uniform2f(I.u.uRes, this.cssW, this.cssH);
            gl.uniform1f(I.u.uDpr, dpr);
            gl.uniform4f(I.u.uRect, r.x, r.y, r.w, r.h);
            gl.uniform2f(I.u.uMouse, mx, my);
            gl.uniform1f(I.u.uPresence, pres);
            gl.uniform1f(I.u.uRadius, this.radiusPx());
            gl.uniform1f(I.u.uStrength, this.strength());
            gl.uniform1f(I.u.uTime, this.time);
            gl.uniform1f(I.u.uAmbient, amb);
            gl.uniform1f(I.u.uIntroVis, introVis);
            gl.uniform1f(I.u.uRest, rest);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

            // particles are invisible at rest in "image" mode: skip them entirely
            if (!this.n || (!this.stateDirty && rest === 0 && introVis >= 1)) return;

            const P = this.pPart;
            gl.useProgram(P.p);
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.stateTex[this.stateIdx]);
            gl.uniform1i(P.u.uState, 0);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, this.homeTex);
            gl.uniform1i(P.u.uHome, 1);
            gl.activeTexture(gl.TEXTURE2);
            gl.bindTexture(gl.TEXTURE_2D, this.colTex);
            gl.uniform1i(P.u.uCol, 2);
            gl.activeTexture(gl.TEXTURE3);
            gl.bindTexture(gl.TEXTURE_2D, this.flowTex[this.flowIdx]);
            gl.uniform1i(P.u.uFlow, 3);
            gl.uniform1i(P.u.uTexW, TEX_W);
            gl.uniform4f(P.u.uRect, r.x, r.y, r.w, r.h);
            gl.uniform2f(P.u.uRes, this.cssW, this.cssH);
            gl.uniform2f(P.u.uMouse, mx, my);
            gl.uniform1f(P.u.uRadius, this.radiusPx());
            gl.uniform1f(P.u.uPresence, pres);
            const spacing = r.w / this.gridW;
            gl.uniform1f(P.u.uDot, spacing * 1.45 * clamp(o.dotSize, 0.2, 3));
            gl.uniform1f(P.u.uTime, this.time);
            gl.uniform1f(P.u.uAmbient, amb);
            gl.uniform1f(P.u.uStreak, (o.streaks ? 1 : 0) * (0.45 + 0.55 * introVis));
            gl.uniform1f(P.u.uIntroVis, introVis);
            gl.uniform1f(P.u.uRest, rest);
            gl.uniform1f(P.u.uDpr, dpr);
            gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.n);
            gl.disable(gl.BLEND);
        }

        destroy() {
            this.destroyed = true;
            this.stop();
            this.canvas.removeEventListener("webglcontextlost", this.onLost);
            const gl = this.gl;
            if (!this.lost) {
                gl.deleteBuffer(this.quad);
                gl.deleteVertexArray(this.vao);
                for (const t of [...this.flowTex, ...this.stateTex, this.imgTex, this.homeTex, this.colTex]) if (t) gl.deleteTexture(t);
                for (const f of [...this.flowFb, ...this.stateFb]) gl.deleteFramebuffer(f);
                for (const p of [this.pFlow, this.pSim, this.pPart, this.pImg]) if (p) gl.deleteProgram(p.p);
            }
            const ext = gl.getExtension("WEBGL_lose_context");
            if (ext) ext.loseContext();
        }
    }

    /* ── layout ──────────────────────────────────────────────────────── */

    // the sculpture sits centred in the band between the top of the hero and
    // the copy, as wide as the hero (it may bleed off the sides on phones)
    function computeRect(w, h, aspect, band) {
        const bandH = Math.max(80, band.bottom - band.top);
        let rw, maxH;
        if (w >= 1024) {
            rw = w * 1.02;
            maxH = bandH * 1.1;
        } else if (w >= 640) {
            rw = w * 1.3;
            maxH = bandH * 1.15;
        } else {
            rw = w * 1.9;
            maxH = bandH * 1.2;
        }
        if (rw / aspect > maxH) rw = maxH * aspect;
        const rh = rw / aspect;
        const cx = w / 2;
        const cy = (band.top + band.bottom) / 2;
        return { x: cx - rw / 2, y: cy - rh / 2, w: rw, h: rh };
    }

    /* ── mount ───────────────────────────────────────────────────────── */

    function mount(root, options) {
        const opts = Object.assign(
            {
                interactive: true,
                strength: 1,
                radius: 220,
                density: 1,
                dotSize: 1,
                spread: 1,
                turbulence: 1,
                liquid: 1,
                streaks: true,
                restStyle: "image",
                returnSpeed: 1,
                ambient: true,
                ambientIntensity: 1,
                speed: 1,
                intro: true,
                autoplay: true,
            },
            options
        );
        const stage = root.querySelector("[data-hero-stage]");
        const hint = root.querySelector("[data-hero-hint]");
        const top = root.querySelector("[data-hero-top]");
        const bottom = root.querySelector("[data-hero-bottom]");
        const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
        const coarse = window.matchMedia("(hover: none), (pointer: coarse)");
        if (hint && coarse.matches && hint.dataset.touchText) hint.textContent = hint.dataset.touchText;

        // the sculpture: a canvas drawn in the page (always pixel-readable), or an image URL
        const image = opts.source || null;
        let aspect = image ? image.width / image.height : 2.5;
        let engine = null;
        let started = false;
        // without WebGL the generated canvas itself is shown, unanimated
        const fallback = image || null;
        if (fallback) {
            fallback.className = "hx-fallback";
            stage.appendChild(fallback);
        }

        const canvas = document.createElement("canvas");
        canvas.className = "hx-canvas";
        stage.appendChild(canvas);
        const fail = () => {
            root.dataset.gl = "off";
        };
        try {
            engine = new LiquidEngine(canvas, Object.assign({}, opts, { reducedMotion: mq.matches }), fail);
        } catch (err) {
            fail();
        }

        const relayout = () => {
            const w = root.clientWidth;
            const h = root.clientHeight;
            // the band runs between the headline and the actions below; the
            // sculpture tucks a little under the headline for depth
            const band = {
                top: top ? top.offsetTop + top.offsetHeight - 24 : 72,
                bottom: bottom ? bottom.offsetTop - 12 : h - 104,
            };
            const rect = computeRect(w, h, aspect, band);
            if (fallback) {
                fallback.style.left = rect.x + "px";
                fallback.style.top = rect.y + "px";
                fallback.style.width = rect.w + "px";
                fallback.style.height = rect.h + "px";
            }
            if (hint) {
                hint.style.left = clamp(rect.x + rect.w / 2, 90, w - 90) + "px";
                hint.style.top = Math.min(rect.y + rect.h * 0.92, band.bottom - 20) + "px";
            }
            if (engine) engine.resize(w, h, rect);
        };

        const ro = new ResizeObserver(relayout);
        ro.observe(root);
        // the band moves when fonts load or the copy reflows
        if (top) ro.observe(top);
        if (bottom) ro.observe(bottom);
        const io = new IntersectionObserver((entries) => {
            for (const e of entries) if (engine) engine.setVisible(e.isIntersecting && !document.hidden);
        });
        io.observe(root);
        document.addEventListener("visibilitychange", () => engine && engine.setVisible(!document.hidden));
        if (mq.addEventListener) mq.addEventListener("change", () => engine && engine.setOptions({ reducedMotion: mq.matches }));

        const pos = (e) => {
            const b = root.getBoundingClientRect();
            return [e.clientX - b.left, e.clientY - b.top];
        };
        const markTouched = () => {
            root.dataset.touched = "1";
        };
        root.addEventListener("pointermove", (e) => {
            const touch = e.pointerType === "touch";
            if (touch && e.buttons === 0 && e.pressure === 0) return;
            const [x, y] = pos(e);
            if (engine) engine.pointer("move", x, y, touch);
            markTouched();
        }, { passive: true });
        root.addEventListener("pointerdown", (e) => {
            const [x, y] = pos(e);
            if (engine) engine.pointer("down", x, y, e.pointerType === "touch");
            markTouched();
        }, { passive: true });
        const up = (e) => {
            const [x, y] = pos(e);
            if (engine) engine.pointer("up", x, y, e.pointerType === "touch");
        };
        root.addEventListener("pointerup", up, { passive: true });
        root.addEventListener("pointercancel", up, { passive: true });
        root.addEventListener("pointerleave", (e) => {
            const [x, y] = pos(e);
            if (engine) engine.pointer("leave", x, y, e.pointerType === "touch");
        }, { passive: true });

        // hand the sculpture to the engine; the WebGL canvas takes over from the
        // static fallback once its first frame has been presented
        const play = () => {
            if (!image || !started) return;
            if (!engine || root.dataset.gl === "off") {
                root.dataset.gl = "off";
                return;
            }
            try {
                engine.onFirstFrame = () => {
                    root.dataset.gl = "on";
                };
                engine.setImage(image);
                relayout();
            } catch (err) {
                root.dataset.gl = "off";
            }
        };

        if (!image) fail();
        relayout();

        return {
            start() {
                if (started) return;
                started = true;
                play();
            },
        };
    }

    window.LiquidHero = { mount };
})();
