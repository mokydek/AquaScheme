/**
 * Decorative schematic of a looped water network drawn in working
 * drawing aesthetics: terrain contours, ring main W1, manholes,
 * source and building service lines. Pure presentational SVG.
 */
export function NetworkFigure() {
  const mono = 'var(--font-mono)'
  const ring = 'M150,110 L330,85 L470,160 L445,305 L270,355 L120,255 Z'

  return (
    <svg viewBox="0 0 560 430" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Схема кольцевой сети водоснабжения">
      <defs>
        <pattern id="nf-grid" width="28" height="28" patternUnits="userSpaceOnUse">
          <path d="M28 0H0V28" fill="none" stroke="#f2f2f2" strokeWidth="1" />
        </pattern>
      </defs>

      <rect width="560" height="430" fill="url(#nf-grid)" />

      {/* Terrain contours */}
      <path d="M0,60 C120,40 200,90 320,55 S480,20 560,45" fill="none" stroke="#dcdcdc" strokeWidth="1" />
      <path d="M0,330 C100,305 220,345 350,315 S500,285 560,300" fill="none" stroke="#dcdcdc" strokeWidth="1" />
      <path d="M0,395 C150,365 260,415 400,385 S520,355 560,370" fill="none" stroke="#dcdcdc" strokeWidth="1" />
      <text x="16" y="52" fontFamily={mono} fontSize="8" fill="#b5b5b5">97.50</text>
      <text x="16" y="322" fontFamily={mono} fontSize="8" fill="#b5b5b5">96.00</text>
      <text x="16" y="388" fontFamily={mono} fontSize="8" fill="#b5b5b5">95.50</text>

      {/* North sign */}
      <line x1="530" y1="44" x2="530" y2="18" stroke="#0a0a0a" strokeWidth="1" />
      <polygon points="530,14 526,24 534,24" fill="#0a0a0a" />
      <text x="538" y="30" fontFamily={mono} fontSize="9" fill="#0a0a0a">С</text>

      {/* Ring main W1 */}
      <path d={ring} fill="none" stroke="#0033cc" strokeWidth="1.5" />

      {/* Supply line from source */}
      <line x1="52" y1="164" x2="150" y2="110" stroke="#0033cc" strokeWidth="2" />
      <rect x="42" y="156" width="14" height="14" fill="#0033cc" />
      <text x="20" y="146" fontFamily={mono} fontSize="9" fill="#0a0a0a">ВОС · А</text>

      {/* Manholes */}
      {[
        { cx: 150, cy: 110, lx: 120, ly: 100, label: 'ВК-1' },
        { cx: 330, cy: 85, lx: 318, ly: 72, label: 'ВК-2' },
        { cx: 470, cy: 160, lx: 482, ly: 158, label: 'ВК-3' },
        { cx: 445, cy: 305, lx: 458, ly: 320, label: 'ВК-4' },
        { cx: 270, cy: 355, lx: 252, ly: 378, label: 'ВК-5' },
        { cx: 120, cy: 255, lx: 78, ly: 252, label: 'ВК-6' },
      ].map((n) => (
        <g key={n.label}>
          <circle cx={n.cx} cy={n.cy} r="4" fill="#ffffff" stroke="#0033cc" strokeWidth="1.25" />
          <text x={n.lx} y={n.ly} fontFamily={mono} fontSize="9" fill="#0a0a0a">{n.label}</text>
        </g>
      ))}

      {/* Pipe annotations */}
      <text x="200" y="78" fontFamily={mono} fontSize="8" fill="#777777">Ø160 ПЭ100</text>
      <text x="464" y="242" fontFamily={mono} fontSize="8" fill="#777777">Ø110</text>
      <text x="138" y="330" fontFamily={mono} fontSize="8" fill="#777777">Ø110 ПЭ100</text>

      {/* Fire hydrant on the top main */}
      <rect x="236" y="93" width="5" height="5" fill="#0033cc" />
      <text x="246" y="106" fontFamily={mono} fontSize="8" fill="#777777">ПГ</text>

      {/* Buildings with service lines */}
      {[
        { x: 200, y: 128, sx: 210, sy: 128, ex: 207, ey: 100 },
        { x: 372, y: 132, sx: 382, sy: 132, ex: 396, ey: 120 },
        { x: 396, y: 248, sx: 416, sy: 254, ex: 452, ey: 250 },
        { x: 298, y: 298, sx: 308, sy: 311, ex: 330, ey: 337 },
        { x: 168, y: 278, sx: 178, sy: 291, ex: 182, ey: 297 },
        { x: 236, y: 200, sx: 246, sy: 213, ex: 246, ey: 250 },
      ].map((b, i) => (
        <g key={i}>
          <line x1={b.sx} y1={b.sy} x2={b.ex} y2={b.ey} stroke="#999999" strokeWidth="0.9" strokeDasharray="3 2" />
          <rect x={b.x} y={b.y} width="20" height="13" fill="#ffffff" stroke="#0a0a0a" strokeWidth="1" />
        </g>
      ))}

      {/* Internal loop hint */}
      <line x1="246" y1="250" x2="120" y2="255" stroke="#0033cc" strokeWidth="0.9" strokeDasharray="5 3" />
      <line x1="246" y1="250" x2="445" y2="305" stroke="#0033cc" strokeWidth="0.9" strokeDasharray="5 3" />
    </svg>
  )
}
