/**
 * Продольный профиль самотёчного коллектора — то, что программа строит.
 *
 * Здесь была кольцевая схема В1: кольцо, водозабор ВОС, пожарный гидрант,
 * вводы в здания. Ветка водоснабжения закрыта флагом `VITE_WATER_SUPPLY`, в
 * приложении её нет, и рисунок обещал посетителю то, чего он не получит, —
 * раньше и убедительнее любого текста на странице.
 *
 * РИСУНОК ДЕКОРАТИВНЫЙ. Он показывает СОСТАВ профиля: поверхность земли, лоток
 * с уклоном, колодцы, глубины заложения и пикетаж — то, из чего профиль
 * состоит и что раздел самотёка действительно считает. Величины на нём круглые
 * и ничьи: это не отрисовка проекта и не результат расчёта. Настоящий профиль
 * живёт в разделе самотёка и выходит в DXF.
 */
export function NetworkFigure() {
  const mono = 'var(--font-mono)'
  const ink = '#0a0a0a'
  const pipe = '#0033cc'
  const faint = '#dcdcdc'

  /** Колодцы: пикет по X, отметка земли и отметка лотка по Y экрана. */
  const wells = [
    { id: 'ВК-1', x: 70, ground: 150, invert: 250, depth: '3,20', station: 'ПК0+00' },
    { id: 'ВК-2', x: 175, ground: 163, invert: 268, depth: '3,55', station: 'ПК0+50' },
    { id: 'ВК-3', x: 280, ground: 172, invert: 286, depth: '3,90', station: 'ПК1+00' },
    { id: 'ВК-4', x: 385, ground: 186, invert: 304, depth: '4,25', station: 'ПК1+50' },
    { id: 'ВК-5', x: 490, ground: 197, invert: 322, depth: '4,60', station: 'ПК2+00' },
  ]
  const groundPath = 'M20,142 C90,150 140,158 175,163 S250,170 280,172 S350,182 385,186 S460,196 540,203'
  const invertPath = wells
    .map((well, index) => `${index === 0 ? 'M' : 'L'}${well.x},${well.invert}`)
    .join(' ')

  return (
    <svg
      viewBox="0 0 560 430"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Продольный профиль самотёчного коллектора: поверхность земли, лоток, колодцы и глубины заложения"
    >
      <defs>
        <pattern id="nf-grid" width="28" height="28" patternUnits="userSpaceOnUse">
          <path d="M28 0H0V28" fill="none" stroke="#f2f2f2" strokeWidth="1" />
        </pattern>
      </defs>

      <rect width="560" height="430" fill="url(#nf-grid)" />

      {/* Шкала отметок */}
      {[
        { y: 140, label: '97.50' },
        { y: 200, label: '96.50' },
        { y: 260, label: '95.50' },
        { y: 320, label: '94.50' },
      ].map((mark) => (
        <g key={mark.label}>
          <line x1="20" y1={mark.y} x2="540" y2={mark.y} stroke={faint} strokeWidth="1" strokeDasharray="2 4" />
          <text x="22" y={mark.y - 4} fontFamily={mono} fontSize="8" fill="#b5b5b5">{mark.label}</text>
        </g>
      ))}

      {/* Поверхность земли */}
      <path d={groundPath} fill="none" stroke={ink} strokeWidth="1.2" />
      <text x="470" y="192" fontFamily={mono} fontSize="9" fill={ink}>земля</text>

      {/* Лоток трубы */}
      <path d={invertPath} fill="none" stroke={pipe} strokeWidth="2" />

      {/* Колодцы: ствол от земли до лотка, обозначение и глубина заложения */}
      {wells.map((well) => (
        <g key={well.id}>
          <line x1={well.x} y1={well.ground} x2={well.x} y2={well.invert} stroke={ink} strokeWidth="1" />
          <rect
            x={well.x - 7}
            y={well.ground - 8}
            width="14"
            height="8"
            fill="#ffffff"
            stroke={ink}
            strokeWidth="1.2"
          />
          <text x={well.x} y={well.ground - 13} fontFamily={mono} fontSize="9" fill={ink} textAnchor="middle">
            {well.id}
          </text>
          <text x={well.x + 10} y={(well.ground + well.invert) / 2} fontFamily={mono} fontSize="8" fill="#5a5a5a">
            {well.depth}
          </text>
        </g>
      ))}

      {/* Диаметр и уклон — то, что подбирает расчёт */}
      <text x="196" y="303" fontFamily={mono} fontSize="10" fill={pipe}>Ø400 · i = 0,004</text>

      {/* Пикетаж */}
      <line x1="20" y1="372" x2="540" y2="372" stroke={ink} strokeWidth="1" />
      {wells.map((well) => (
        <g key={well.station}>
          <line x1={well.x} y1="368" x2={well.x} y2="376" stroke={ink} strokeWidth="1" />
          <text x={well.x} y="390" fontFamily={mono} fontSize="8" fill={ink} textAnchor="middle">
            {well.station}
          </text>
        </g>
      ))}
      <text x="20" y="412" fontFamily={mono} fontSize="8" fill="#b5b5b5">
        Продольный профиль · глубины заложения, м
      </text>
    </svg>
  )
}
