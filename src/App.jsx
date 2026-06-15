import { useEffect, useRef, useState } from "react";

export default function App() {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);

  const [devices, setDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState("");
  const [mode, setMode] = useState("waveform");
  const [showMenu, setShowMenu] = useState(false);

  const analyserRef = useRef(null);
  const dataRef = useRef(null);

  useEffect(() => {
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then(() => navigator.mediaDevices.enumerateDevices())
      .then((devices) => {
        const inputs = devices.filter((d) => d.kind === "audioinput");
        setDevices(inputs);
        if (inputs.length) setSelectedDevice(inputs[0].deviceId);
      });
  }, []);

  const initGL = () => {
    const canvas = canvasRef.current;
    const gl = canvas.getContext("webgl");

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();
    window.onresize = resize;

    // ✅ additive blending for CRT glow
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

    const vs = `
 attribute float a_index;
 uniform float u_len;
 uniform float u_mode;
 uniform sampler2D u_tex;

 float sample(float i){
 float x = i / u_len;
 return texture2D(u_tex, vec2(x, 0.0)).r * 2.0 - 1.0;
 }

 void main(){
 float i = a_index;
 float x;
 float y;

 if(u_mode < 0.5){
 x = (i / u_len) * 2.0 - 1.0;
 y = sample(i);
 } else {
 x = sample(i);
 y = sample(mod(i + 64.0, u_len));
 }

 gl_Position = vec4(x, y, 0.0, 1.0);
 }
 `;

    const fs = `
 precision mediump float;


 void main(){
 // simulated thick CRT beam using radial falloff
 float dist = abs(gl_PointCoord.y - 0.5);
 float core = exp(-dist * 200.0);
 float glow = exp(-dist * 20.0);


 float intensity = core * 1.0 + glow * 0.6;


 vec3 color = vec3(0.0, 1.0, 0.0) * intensity;
 gl_FragColor = vec4(color, intensity);
 }
 `;

    const compile = (t, s) => {
      const sh = gl.createShader(t);
      gl.shaderSource(sh, s);
      gl.compileShader(sh);
      return sh;
    };

    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const N = 1024;
    const indices = new Float32Array(N);
    for (let i = 0; i < N; i++) indices[i] = i;

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, indices, gl.STATIC_DRAW);

    const aIndex = gl.getAttribLocation(prog, "a_index");
    gl.enableVertexAttribArray(aIndex);
    gl.vertexAttribPointer(aIndex, 1, gl.FLOAT, false, 0, 0);

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    const uLen = gl.getUniformLocation(prog, "u_len");
    const uMode = gl.getUniformLocation(prog, "u_mode");

    let last = 0;
    const dt = 1000 / 60;

    const draw = (t) => {
      rafRef.current = requestAnimationFrame(draw);
      if (t - last < dt) return;
      last = t;

      const analyser = analyserRef.current;
      const data = dataRef.current;
      if (!analyser || !data) return;

      analyser.getFloatTimeDomainData(data);

      const texData = new Uint8Array(data.length);
      for (let i = 0; i < data.length; i++) {
        texData[i] = (data[i] * 0.5 + 0.5) * 255;
      }

      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.LUMINANCE,
        data.length,
        1,
        0,
        gl.LUMINANCE,
        gl.UNSIGNED_BYTE,
        texData,
      );

      // ✅ strong persistence (CRT fade)
      gl.clearColor(0, 0, 0, 0.04);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.uniform1f(uLen, data.length);
      gl.uniform1f(uMode, mode === "waveform" ? 0 : 1);

      // ✅ draw thicker line (multiple passes)
      for (let i = -2; i <= 2; i++) {
        gl.drawArrays(gl.LINE_STRIP, 0, data.length);
      }
    };

    draw(0);
  };

  useEffect(() => {
    if (!selectedDevice) return;

    navigator.mediaDevices
      .getUserMedia({ audio: { deviceId: { exact: selectedDevice } } })
      .then((stream) => {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const src = ctx.createMediaStreamSource(stream);

        // ✅ low-pass filter (smooth signal)
        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = 1500;

        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;

        const data = new Float32Array(analyser.fftSize);

        src.connect(filter);
        filter.connect(analyser);
        analyserRef.current = analyser;
        dataRef.current = data;

        initGL();
      });

    return () => cancelAnimationFrame(rafRef.current);
  }, [selectedDevice, mode]);

  return (
    <div style={{ overflow: "hidden", background: "black" }}>
      <canvas ref={canvasRef} style={{ position: "fixed", top: 0, left: 0 }} />

      <button
        onClick={() => setShowMenu(!showMenu)}
        style={{ position: "fixed", top: 10, left: 10 }}
      >
        ☰
      </button>

      <div
        style={{
          position: "fixed",
          top: 0,
          left: showMenu ? 0 : "-320px",
          width: 300,
          height: "100%",
          background: "#050",
          color: "#0f0",
          padding: 20,
          transition: "left 0.2s",
        }}
      >
        <h3>Oscilloscope</h3>

        <label>Input</label>
        <select
          value={selectedDevice}
          onChange={(e) => setSelectedDevice(e.target.value)}
          style={{ width: "100%" }}
        >
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || "Device"}
            </option>
          ))}
        </select>

        <label style={{ marginTop: 10 }}>Mode</label>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          style={{ width: "100%" }}
        >
          <option value="waveform">Waveform</option>
          <option value="lissajous">Lissajous</option>
        </select>
      </div>
    </div>
  );
}
