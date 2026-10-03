export const VERT = /* glsl */ `
varying vec2 vUv;
varying vec2 vW;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xy;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

export const FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec4 uCrop;
uniform float uOutside, uEdit, uGray, uLevels, uBias, uBlur, uContrast, uBright, uLineW, uOpA, uOpB;
uniform vec3 uColA, uColB;
uniform int uAnv, uAnh, uBnv, uBnh, uBns;
uniform float uAv[48];
uniform float uAh[48];
uniform float uBv[16];
uniform float uBh[16];
uniform vec4 uBs[8];
varying vec2 vUv;
varying vec2 vW;

float cov(float d, float w) { return clamp(w * 0.5 + 0.5 - d, 0.0, 1.0); }
float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h);
}

void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  float r = uBlur * 0.012;
  float lod = uBlur * 6.0;
  vec3 c = vec3(0.0);
  for (int i = -1; i <= 1; i++)
    for (int j = -1; j <= 1; j++)
      c += textureLod(uMap, uv + vec2(float(i), float(j)) * r, lod).rgb;
  c /= 9.0;
  c = (c - 0.5) * uContrast + 0.5 + uBright;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  if (uGray > 0.5) c = vec3(l);
  if (uLevels > 1.5) {
    float q = clamp(l + uBias, 0.0, 1.0);
    float lv = min(floor(q * uLevels), uLevels - 1.0) / (uLevels - 1.0);
    c = vec3(lv);
  }

  vec2 px = fwidth(vW);
  vec2 sz = uCrop.zw - uCrop.xy;
  bool inside = vW.x >= uCrop.x && vW.x <= uCrop.z && vW.y >= uCrop.y && vW.y <= uCrop.w;
  if (!inside) {
    if (uOutside > 0.999) discard;
    c = mix(c, vec3(0.1), uOutside);
  }

  if (inside) {
    vec2 cu = (vW - uCrop.xy) / sz;
    float coreA = 0.0, haloA = 0.0, coreB = 0.0, haloB = 0.0;
    for (int i = 0; i < 48; i++) {
      if (i < uAnv) {
        float e = uAv[i]; float w = e > 5.0 ? 2.0 : 1.0; e -= (w - 1.0) * 10.0;
        float d = abs(vW.x - (uCrop.x + e * sz.x)) / px.x;
        coreA = max(coreA, cov(d, uLineW * w)); haloA = max(haloA, cov(d, uLineW * w + 3.0));
      }
      if (i < uAnh) {
        float e = uAh[i]; float w = e > 5.0 ? 2.0 : 1.0; e -= (w - 1.0) * 10.0;
        float d = abs(vW.y - (uCrop.y + e * sz.y)) / px.y;
        coreA = max(coreA, cov(d, uLineW * w)); haloA = max(haloA, cov(d, uLineW * w + 3.0));
      }
    }
    for (int i = 0; i < 16; i++) {
      if (i < uBnv) {
        float e = uBv[i]; float w = e > 5.0 ? 2.0 : 1.0; e -= (w - 1.0) * 10.0;
        float d = abs(vW.x - (uCrop.x + e * sz.x)) / px.x;
        coreB = max(coreB, cov(d, uLineW * w)); haloB = max(haloB, cov(d, uLineW * w + 3.0));
      }
      if (i < uBnh) {
        float e = uBh[i]; float w = e > 5.0 ? 2.0 : 1.0; e -= (w - 1.0) * 10.0;
        float d = abs(vW.y - (uCrop.y + e * sz.y)) / px.y;
        coreB = max(coreB, cov(d, uLineW * w)); haloB = max(haloB, cov(d, uLineW * w + 3.0));
      }
    }
    vec2 pp = vW / px;
    for (int i = 0; i < 8; i++) {
      if (i < uBns) {
        vec4 s = uBs[i];
        vec2 a = (uCrop.xy + s.xy * sz) / px;
        vec2 b = (uCrop.xy + s.zw * sz) / px;
        float d = segDist(pp, a, b);
        coreB = max(coreB, cov(d, uLineW)); haloB = max(haloB, cov(d, uLineW + 3.0));
      }
    }
    c = mix(c, vec3(0.0), haloA * 0.35 * uOpA);
    c = mix(c, uColA, coreA * uOpA);
    c = mix(c, vec3(0.0), haloB * 0.35 * uOpB);
    c = mix(c, uColB, coreB * uOpB);
  }

  if (uEdit > 0.5) {
    float dx = min(abs(vW.x - uCrop.x), abs(vW.x - uCrop.z)) / px.x;
    float dy = min(abs(vW.y - uCrop.y), abs(vW.y - uCrop.w)) / px.y;
    bool near = vW.x >= uCrop.x - 3.0 * px.x && vW.x <= uCrop.z + 3.0 * px.x && vW.y >= uCrop.y - 3.0 * px.y && vW.y <= uCrop.w + 3.0 * px.y;
    if (near) c = mix(c, vec3(1.0), cov(min(dx, dy), uLineW * 1.8));
  }
  gl_FragColor = vec4(c, 1.0);
}`;
