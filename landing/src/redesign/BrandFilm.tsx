/**
 * C-Point brand film v2 — deep-space edition (Home intro).
 * Port of design_handoff_landing_redesign/brand-film-v2.jsx: a 14s looping,
 * deterministic timeline (starfield + nebula + shooting stars; noise particles
 * converge into two orbit rings around the Steve logo; constellation lines;
 * tagline). All math matches the handoff prototype.
 *
 * Rendering: a fixed 1920x1080 stage scaled to cover its container, driven by
 * a single rAF clock (~30fps). prefers-reduced-motion users get the static
 * final frame with no clock.
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useLang } from "@/i18n/LanguageContext";
import steveLogo from "@/assets/steve-logo.png";

const TEAL = "#4db6ac";
const CX = 960;
const CY = 470;
const DURATION = 14;

/* ---------- easing / timeline math (mirrors the prototype engine) ---------- */
type Ease = (t: number) => number;
const easeOutQuad: Ease = (t) => 1 - (1 - t) * (1 - t);
const easeOutCubic: Ease = (t) => 1 - Math.pow(1 - t, 3);
const easeInOutQuad: Ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const easeInOutCubic: Ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutBack: Ease = (t) => {
  const c1 = 1.70158;
  return 1 + (c1 + 1) * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

/** Piecewise interpolation over (time points → values), eased per segment. */
function interpolate(times: number[], values: number[], ease: Ease): (t: number) => number {
  return (t) => {
    if (t <= times[0]) return values[0];
    for (let i = 1; i < times.length; i++) {
      if (t <= times[i]) {
        const p = (t - times[i - 1]) / (times[i] - times[i - 1]);
        return values[i - 1] + (values[i] - values[i - 1]) * ease(p);
      }
    }
    return values[values.length - 1];
  };
}
function animate(opts: { from: number; to: number; start: number; end: number; ease: Ease }): (t: number) => number {
  return interpolate([opts.start, opts.end], [opts.from, opts.to], opts.ease);
}

/** Deterministic pseudo-random (same seed constants as the prototype). */
function rnd(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/* ---------- deterministic scene data ---------- */
type Particle = {
  x0: number; y0: number; dx: number; dy: number;
  ring: number; angle: number; speed: number; size: number; tPull: number; dur: number;
};
const PARTICLES: Particle[] = (() => {
  const r = rnd(42);
  const out: Particle[] = [];
  for (let i = 0; i < 26; i++) {
    const ring = i % 2 === 0 ? 250 : 385;
    out.push({
      x0: 120 + r() * 1680,
      y0: 60 + r() * 900,
      dx: (r() - 0.5) * 90,
      dy: (r() - 0.5) * 70,
      ring,
      angle: r() * Math.PI * 2,
      speed: (ring === 250 ? 0.22 : -0.15) * (0.8 + r() * 0.4),
      size: 5 + r() * 6,
      tPull: 3.2 + r() * 1.6,
      dur: 1.6 + r() * 0.8,
    });
  }
  return out;
})();

const STARS = (() => {
  const r = rnd(7);
  const out: { x: number; y: number; s: number; tw: number; ph: number; warm: boolean }[] = [];
  for (let i = 0; i < 160; i++) {
    out.push({ x: r() * 1920, y: r() * 1080, s: 0.8 + r() * 1.8, tw: 1 + r() * 2.4, ph: r() * 6.28, warm: r() > 0.85 });
  }
  return out;
})();

function posAt(p: Particle, i: number, t: number) {
  const cxr = p.x0 + Math.sin(t * 0.9 + i * 2.1) * p.dx + Math.cos(t * 0.6 + i) * 18;
  const cyr = p.y0 + Math.cos(t * 0.8 + i * 1.7) * p.dy + Math.sin(t * 0.5 + i) * 14;
  const a = p.angle + (t - p.tPull) * p.speed;
  const ox = CX + Math.cos(a) * p.ring;
  const oy = CY + Math.sin(a) * p.ring;
  const k = easeInOutCubic(Math.min(1, Math.max(0, (t - p.tPull) / p.dur)));
  return { x: cxr + (ox - cxr) * k, y: cyr + (oy - cyr) * k, k };
}

/* ---------- film clock ---------- */
const TimeContext = createContext(13); // static fallback shows the final frame
const useTime = () => useContext(TimeContext);

/* ---------- scene layers ---------- */
function Starfield() {
  const t = useTime();
  const drift = t * 2.2;
  return (
    <div style={{ position: "absolute", inset: -60, transform: `translate(${-drift * 0.4}px, ${-drift * 0.15}px) scale(1.06)` }}>
      {STARS.map((s, i) => {
        const o = 0.35 + 0.65 * (0.5 + Math.sin(t * s.tw + s.ph) * 0.5);
        return (
          <div
            key={i}
            style={{
              position: "absolute", left: s.x, top: s.y, width: s.s, height: s.s,
              borderRadius: "50%", background: s.warm ? "#ffe9c4" : "#eef6f4", opacity: o,
              boxShadow: s.s > 2 ? `0 0 ${s.s * 3}px rgba(238,246,244,${o * 0.6})` : "none",
            }}
          />
        );
      })}
    </div>
  );
}

function Nebula() {
  const t = useTime();
  const blob = (key: number, style: CSSProperties) => (
    <div key={key} style={{ position: "absolute", transform: "translate(-50%,-50%)", ...style }} />
  );
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      {blob(0, { left: 380 + Math.sin(t * 0.12) * 40, top: 260 + Math.cos(t * 0.1) * 30, width: 1100, height: 720, background: "radial-gradient(ellipse at center, rgba(77,182,172,.10), transparent 60%)", filter: "blur(30px)" })}
      {blob(1, { left: 1500 - Math.sin(t * 0.09) * 50, top: 760 + Math.sin(t * 0.11) * 36, width: 1000, height: 680, background: "radial-gradient(ellipse at center, rgba(46,84,120,.14), transparent 60%)", filter: "blur(34px)" })}
      {blob(2, { left: 1050, top: 140, width: 900, height: 460, background: "radial-gradient(ellipse at center, rgba(120,90,160,.07), transparent 60%)", filter: "blur(38px)" })}
    </div>
  );
}

function ShootingStars() {
  const t = useTime();
  const passes = [
    { t0: 2.0, dur: 1.7, x1: -140, y1: 210, x2: 2080, y2: 830 },
    { t0: 9.2, dur: 1.6, x1: 2080, y1: 300, x2: -140, y2: 700 },
  ];
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 14, pointerEvents: "none" }}>
      {passes.map((sh, i) => {
        const p = (t - sh.t0) / sh.dur;
        if (p < 0 || p > 1) return null;
        const e = easeInOutQuad(p);
        const x = sh.x1 + (sh.x2 - sh.x1) * e;
        const y = sh.y1 + (sh.y2 - sh.y1) * e;
        const ang = (Math.atan2(sh.y2 - sh.y1, sh.x2 - sh.x1) * 180) / Math.PI;
        const fade = p < 0.12 ? p / 0.12 : p > 0.85 ? (1 - p) / 0.15 : 1;
        const trail = 320 * (0.6 + 0.4 * Math.sin(p * Math.PI));
        return (
          <div key={i} style={{ position: "absolute", left: x, top: y, transform: `rotate(${ang}deg)`, transformOrigin: "left center", opacity: fade }}>
            <div style={{ position: "absolute", right: 0, top: -1.5, width: trail, height: 3, borderRadius: 3, background: "linear-gradient(to left, rgba(242,245,244,.95), rgba(77,182,172,.5) 40%, transparent)" }} />
            <div style={{ position: "absolute", left: -4, top: -4, width: 8, height: 8, borderRadius: "50%", background: "#fff", boxShadow: "0 0 18px rgba(242,245,244,.95), 0 0 42px rgba(77,182,172,.7)" }} />
          </div>
        );
      })}
    </div>
  );
}

function NoiseLines() {
  const t = useTime();
  const o = interpolate([0, 0.8, 3.2, 4.6], [0, 0.35, 0.35, 0], easeInOutQuad)(t);
  if (o <= 0.001) return null;
  const segs = [];
  for (let i = 0; i < 9; i++) {
    const a = PARTICLES[i * 2];
    const b = PARTICLES[i * 2 + 1];
    const ax = a.x0 + Math.sin(t * 0.9 + i * 2 * 2.1) * a.dx;
    const ay = a.y0 + Math.cos(t * 0.8 + i * 2 * 1.7) * a.dy;
    const bx = b.x0 + Math.sin(t * 0.9 + (i * 2 + 1) * 2.1) * b.dx;
    const by = b.y0 + Math.cos(t * 0.8 + (i * 2 + 1) * 1.7) * b.dy;
    segs.push(<line key={i} x1={ax} y1={ay} x2={bx} y2={by} stroke="rgba(242,245,244,.16)" strokeWidth={1} />);
  }
  return (
    <svg width={1920} height={1080} style={{ position: "absolute", inset: 0, opacity: o }}>
      {segs}
    </svg>
  );
}

function Particles() {
  const t = useTime();
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 12 }}>
      {PARTICLES.map((p, i) => {
        const { x, y, k } = posAt(p, i, t);
        const tw = 0.75 + Math.sin(t * 2.2 + i * 1.3) * 0.25;
        const glow = (k > 0.9 ? 0.85 : 0.45 + k * 0.3) * tw;
        return (
          <div
            key={i}
            style={{
              position: "absolute", left: x, top: y, width: p.size, height: p.size,
              borderRadius: "50%", transform: "translate(-50%,-50%)",
              background: k > 0.5 ? TEAL : "rgba(242,245,244,.55)",
              opacity: 0.7 + tw * 0.3,
              boxShadow: k > 0.5 ? `0 0 ${10 + p.size * 2}px rgba(77,182,172,${glow})` : "0 0 6px rgba(242,245,244,.25)",
            }}
          />
        );
      })}
    </div>
  );
}

function Constellation() {
  const t = useTime();
  const oAll = interpolate([5.2, 6.6], [0, 1], easeOutQuad)(t);
  if (oAll <= 0.001) return null;
  const pts = PARTICLES.map((p, i) => ({ ...posAt(p, i, t), ring: p.ring, i }));
  const segs: ReactNode[] = [];
  [250, 385].forEach((ring) => {
    const onRing = pts.filter((q) => q.ring === ring && q.k > 0.85);
    onRing.sort((a, b) => Math.atan2(a.y - CY, a.x - CX) - Math.atan2(b.y - CY, b.x - CX));
    for (let j = 0; j < onRing.length; j++) {
      const a = onRing[j];
      const b = onRing[(j + 1) % onRing.length];
      segs.push(<line key={`${ring}-${j}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="rgba(77,182,172,.20)" strokeWidth={1} />);
    }
  });
  pts
    .filter((q) => q.k > 0.9 && q.i % 4 === 0)
    .forEach((q) => {
      const pulse = 0.1 + 0.1 * (0.5 + Math.sin(t * 1.3 + q.i) * 0.5);
      segs.push(<line key={`c${q.i}`} x1={CX} y1={CY} x2={q.x} y2={q.y} stroke={`rgba(77,182,172,${pulse})`} strokeWidth={1} />);
    });
  return (
    <svg width={1920} height={1080} style={{ position: "absolute", inset: 0, opacity: oAll, zIndex: 10 }}>
      {segs}
    </svg>
  );
}

function Rings() {
  const t = useTime();
  const o = interpolate([4.2, 5.4], [0, 1], easeOutCubic)(t);
  const breathe = 1 + Math.sin(t * 1.4) * 0.008;
  return (
    <div style={{ position: "absolute", inset: 0, opacity: o, zIndex: 8 }}>
      {[250, 385].map((r, i) => (
        <div
          key={i}
          style={{
            position: "absolute", left: CX, top: CY, width: r * 2, height: r * 2,
            transform: `translate(-50%,-50%) scale(${breathe})`, borderRadius: "50%",
            border: `1px solid rgba(77,182,172,${i === 0 ? 0.22 : 0.14})`,
          }}
        />
      ))}
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
        <circle
          cx={CX} cy={CY} r={318} fill="none"
          stroke="rgba(77,182,172,.28)" strokeWidth={1}
          strokeDasharray="3 14" strokeLinecap="round"
          transform={`rotate(${t * 6} ${CX} ${CY})`}
        />
      </svg>
    </div>
  );
}

function Ripples() {
  const t = useTime();
  if (t < 6) return null;
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      {[6.6, 7.1, 10.8].map((t0, i) => {
        const p = (t - t0) / 1.6;
        if (p < 0 || p > 1) return null;
        const e = easeOutCubic(p);
        return (
          <div
            key={i}
            style={{
              position: "absolute", left: CX, top: CY,
              width: 160 + e * 640, height: 160 + e * 640,
              transform: "translate(-50%,-50%)", borderRadius: "50%",
              border: `2px solid rgba(77,182,172,${0.5 * (1 - p)})`,
            }}
          />
        );
      })}
    </div>
  );
}

function Logo() {
  const t = useTime();
  if (t < 6) return null;
  const s = animate({ from: 0.2, to: 1, start: 6.3, end: 7.1, ease: easeOutBack })(t);
  const o = animate({ from: 0, to: 1, start: 6.3, end: 6.8, ease: easeOutQuad })(t);
  const glow = 0.45 + Math.sin(t * 1.6) * 0.15;
  return (
    <div
      style={{
        position: "absolute", left: CX, top: CY, opacity: o,
        transform: `translate(-50%,-50%) scale(${s})`,
        width: 176, height: 176, borderRadius: "50%",
        background: "#0e1c19",
        border: "2px solid rgba(77,182,172,.6)",
        display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
        boxShadow: `0 0 120px rgba(77,182,172,${glow}), 0 0 40px rgba(77,182,172,.5), 0 30px 80px rgba(0,0,0,.5)`,
        zIndex: 20,
      }}
    >
      <img src={steveLogo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%" }} />
    </div>
  );
}

function Tagline({ words }: { words: string[] }) {
  const t = useTime();
  if (t < 8) return null;
  return (
    <div
      style={{
        position: "absolute", left: 0, right: 0, top: 880, textAlign: "center", zIndex: 40,
        display: "flex", justifyContent: "center", gap: 18,
      }}
    >
      {words.map((w, i) => {
        const t0 = 8.6 + i * 0.75;
        const o = animate({ from: 0, to: 1, start: t0, end: t0 + 0.55, ease: easeOutQuad })(t);
        const y = animate({ from: 14, to: 0, start: t0, end: t0 + 0.55, ease: easeOutCubic })(t);
        return (
          <span
            key={i}
            style={{
              fontSize: 34, fontWeight: 600, letterSpacing: ".06em",
              color: i === 2 ? TEAL : "rgba(242,245,244,.72)",
              opacity: o, transform: `translateY(${y}px)`, display: "inline-block", whiteSpace: "nowrap",
            }}
          >
            {w}
          </span>
        );
      })}
    </div>
  );
}

function OpeningCaption({ text }: { text: string }) {
  const t = useTime();
  if (t >= 5) return null;
  const o = interpolate([0.8, 1.6, 3.4, 4.2], [0, 1, 1, 0], easeInOutQuad)(t);
  return (
    <div
      style={{
        position: "absolute", left: 0, right: 0, top: 120, textAlign: "center", opacity: o,
        fontSize: 24, fontWeight: 500, letterSpacing: ".3em", textTransform: "uppercase",
        color: "rgba(242,245,244,.5)",
      }}
    >
      {text}
    </div>
  );
}

function Url() {
  const t = useTime();
  if (t < 11) return null;
  const o = animate({ from: 0, to: 1, start: 11.6, end: 12.4, ease: easeOutQuad })(t);
  return (
    <div
      style={{
        position: "absolute", left: 0, right: 0, bottom: 70, textAlign: "center", opacity: o,
        fontSize: 20, fontWeight: 600, letterSpacing: ".28em", textTransform: "uppercase",
        color: "rgba(242,245,244,.45)",
      }}
    >
      c-point.co
    </div>
  );
}

/* ---------- stage ---------- */
export function BrandFilm() {
  const { lang } = useLang();
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  const [time, setTime] = useState(13);

  const reduced = useMemo(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Desktop/tablet: cover the container, but never crop the ~660px core
    // column (tagline/logo). Phones (<720px): fit the whole composition —
    // outer ring (770px) + opening caption (~840px with margins) — inside the
    // viewport; the unused stage height blends into the film background.
    const onResize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      const scale = w < 720
        ? Math.min(w / 840, h / 1080)
        : Math.min(Math.max(w / 1920, h / 1080), w / 660);
      setScale(scale);
    };
    onResize();
    const ro = new ResizeObserver(onResize);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (reduced) return;
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    let running = false;
    let start = 0;
    let last = -1;
    const tick = (now: number) => {
      if (!running) return;
      if (!start) start = now;
      // ~30fps is plenty for this scene and halves the layout work
      const frame = Math.floor((now - start) / 33);
      if (frame !== last) {
        last = frame;
        setTime(((now - start) / 1000) % DURATION);
      }
      raf = requestAnimationFrame(tick);
    };
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !running) {
          running = true;
          raf = requestAnimationFrame(tick);
        } else if (!entry.isIntersecting && running) {
          running = false;
          cancelAnimationFrame(raf);
        }
      },
      { threshold: 0.05 },
    );
    io.observe(el);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, [reduced]);

  const tagline = lang === "pt"
    ? ["As tuas pessoas.", "O teu mundo.", "Sem ruído."]
    : ["Your people.", "Your world.", "No noise."];
  const caption = lang === "pt" ? "Demasiado ruído. Demasiados estranhos." : "Too much noise. Too many strangers.";

  return (
    <div ref={ref} style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#05080c" }} aria-hidden="true">
      <TimeContext.Provider value={reduced ? 13 : time}>
        <div
          style={{
            position: "absolute", left: "50%", top: "50%",
            width: 1920, height: 1080,
            transform: `translate(-50%,-50%) scale(${scale})`,
            fontFamily: "'Hanken Grotesk', system-ui, sans-serif",
          }}
        >
          <Nebula />
          <Starfield />
          <ShootingStars />
          <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse 55% 50% at 50% 44%, rgba(77,182,172,.09), transparent)" }} />
          <NoiseLines />
          <Particles />
          <Constellation />
          <Rings />
          <OpeningCaption text={caption} />
          <Ripples />
          <Logo />
          <Tagline words={tagline} />
          <Url />
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(ellipse 70% 65% at 50% 44%, transparent 55%, rgba(0,0,0,.55) 100%)" }} />
        </div>
      </TimeContext.Provider>
    </div>
  );
}
