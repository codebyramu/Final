const VS = `
attribute vec2 p;
varying vec2 vUv;
void main(){ 
  gl_Position = vec4(p, 0, 1); 
}
`;

const FS = `
precision highp float;
uniform vec2  res;
uniform sampler2D tex;
uniform vec2  trail[60];
uniform float age[60];
uniform float time;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(
    mix(hash(i), hash(i+vec2(1,0)), f.x),
    mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
}

void main(){
  vec2 uv = gl_FragCoord.xy / res;
  vec2 asp = vec2(res.x / res.y, 1.0);

  vec2 warp = vec2(0.0);
  float heat = 0.0;

  for(int i = 0; i < 60; i++){
    if(age[i] < 0.001) continue;
    float a  = age[i];
    vec2  tp = vec2(trail[i].x / res.x, trail[i].y / res.y);
    vec2  d  = (uv - tp) * asp;
    float dist = length(d);

    float sigma = 0.1;
    float gauss = exp(-dist * dist / (2.0 * sigma * sigma));

    warp -= normalize(d + 0.00001) * gauss * a * 0.06;
    heat += gauss * a;
  }

  float nx = (noise(uv * 5.0 + time * 0.2) - 0.5) * 0.004;
  float ny = (noise(uv * 5.0 - time * 0.2 + 3.7) - 0.5) * 0.004;
  warp += vec2(nx, ny) * clamp(heat, 0.0, 1.0);

  vec4 color = texture2D(tex, uv + warp);
  gl_FragColor = color;
}
`;

class LiquidCanvas {
  constructor(canvas, imgUrl) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false });
    this.N = 60;
    this.trail = Array.from({length: this.N}, () => ({x: -1000, y: -1000, a: 0}));
    this.lx = -1; this.ly = -1;
    this.vx = 0; this.vy = 0;
    this.isMoving = false;
    this.stopTimer = null;
    this.loaded = false;
    this.start = performance.now();
    
    this.initWebGL();
    this.loadImage(imgUrl);
    this.setupEvents();
    
    new ResizeObserver(() => this.resize()).observe(this.canvas.parentElement);
    this.resize();
  }
  
  mkShader(type, src) {
    const s = this.gl.createShader(type);
    this.gl.shaderSource(s, src);
    this.gl.compileShader(s);
    return s;
  }
  
  initWebGL() {
    const gl = this.gl;
    this.prog = gl.createProgram();
    gl.attachShader(this.prog, this.mkShader(gl.VERTEX_SHADER, VS));
    gl.attachShader(this.prog, this.mkShader(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(this.prog);
    gl.useProgram(this.prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    const aP = gl.getAttribLocation(this.prog, 'p');
    gl.enableVertexAttribArray(aP);
    gl.vertexAttribPointer(aP, 2, gl.FLOAT, false, 0, 0);

    this.texture = gl.createTexture();
    this.uRes   = gl.getUniformLocation(this.prog, 'res');
    this.uTex   = gl.getUniformLocation(this.prog, 'tex');
    this.uTrail = gl.getUniformLocation(this.prog, 'trail');
    this.uAge   = gl.getUniformLocation(this.prog, 'age');
    this.uTime  = gl.getUniformLocation(this.prog, 'time');
  }
  
  loadImage(url) {
    const img = new Image();
    // Removed crossOrigin to avoid CORS issues on local/file:// loads
    img.onload = () => {
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.loaded = true;
      this.loop();
    };
    img.src = url;
  }
  
  push(x, y) {
    for (let i = this.N - 1; i > 0; i--) {
      this.trail[i].x = this.trail[i-1].x;
      this.trail[i].y = this.trail[i-1].y;
      this.trail[i].a = this.trail[i-1].a * 0.97;
    }
    this.trail[0].x = x;
    this.trail[0].y = y;
    this.trail[0].a = 1.0;
  }
  
  onMove(cx, cy) {
    if (!this.loaded) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = cx - rect.left;
    const y = this.canvas.height - (cy - rect.top); // flip Y for WebGL
    
    if (this.lx >= 0) {
      this.vx = this.vx * 0.5 + (x - this.lx) * 0.5;
      this.vy = this.vy * 0.5 + (y - this.ly) * 0.5;
    }
    this.push(x, y);
    this.lx = x;
    this.ly = y;
    this.isMoving = true;
    clearTimeout(this.stopTimer);
    this.stopTimer = setTimeout(() => { this.isMoving = false; }, 60);
  }
  
  setupEvents() {
    const parent = this.canvas.parentElement;
    parent.addEventListener('mousemove', e => this.onMove(e.clientX, e.clientY));
    parent.addEventListener('mouseleave', () => { this.isMoving = false; this.lx = -1; this.ly = -1; });
    parent.addEventListener('touchmove', e => {
      const t = e.touches[0];
      this.onMove(t.clientX, t.clientY);
    }, {passive: true});
    parent.addEventListener('touchend', () => { this.isMoving = false; this.lx = -1; this.ly = -1; });
  }
  
  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width = rect.width;
    this.canvas.height = rect.height;
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }
  
  loop() {
    if (!this.loaded) return;
    
    if (!this.isMoving && this.lx >= 0 && (Math.abs(this.vx) > 0.2 || Math.abs(this.vy) > 0.2)) {
      this.lx += this.vx;
      this.ly += this.vy;
      this.push(this.lx, this.ly);
      this.vx *= 0.90;
      this.vy *= 0.90;
    }
    for (let i = 0; i < this.N; i++) this.trail[i].a *= 0.993;

    const t = (performance.now() - this.start) / 1000;
    const gl = this.gl;
    
    gl.clearColor(0,0,0,0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.uniform2f(this.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.uTime, t);
    gl.uniform1i(this.uTex, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);

    const pts  = new Float32Array(this.N * 2);
    const ages = new Float32Array(this.N);
    for (let i = 0; i < this.N; i++) {
      pts[i*2]   = this.trail[i].x;
      pts[i*2+1] = this.trail[i].y;
      ages[i]    = this.trail[i].a;
    }
    gl.uniform2fv(this.uTrail, pts);
    gl.uniform1fv(this.uAge, ages);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    requestAnimationFrame(() => this.loop());
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.liquid-canvas').forEach(canvas => {
    const img = canvas.getAttribute('data-img');
    if (img) new LiquidCanvas(canvas, img);
  });
});
