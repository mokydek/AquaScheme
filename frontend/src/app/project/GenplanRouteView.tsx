import { ZoomPanSurface } from './ZoomPanSurface'

const GENPLAN_FACTS = [
  ['Основание', '«Схема ЛК от Генплан с диаметрами» — первичный документ трассировки'],
  ['Планировочные ограничения', 'Улично-дорожная сеть, красные линии и размещение существующей застройки'],
  ['Трасса', 'Ломаная ось коридора из генплана; прямые связи между ОС не создаются'],
  ['Сооружения', 'ОС III-6, ОС II-1, ОС III-8, ОС III-4 и проектная ЛНС'],
  ['Расходы', '200; 1154,7; 531; 611 л/с, ЛНС — 2335,8 л/с'],
  ['Диаметры генплана', 'Ø1200, 2×Ø800 и основные участки Ø2000'],
] as const

export function GenplanRouteView() {
  return (
    <div className="reference-situation genplan-route-view">
      <figure className="reference-situation-sheet">
        <figcaption>
          <strong>Генплан — основание проектной трассы</strong>
          <span>исходный PDF заказчика · без автоматического спрямления</span>
        </figcaption>
        <ZoomPanSurface label="Масштабируемая схема ЛК из генплана">
          <img
            src="/reference/genplan-lk.png"
            alt="Схема ливневой канализации из генплана с проектной трассой и диаметрами"
          />
        </ZoomPanSurface>
      </figure>
      <ol className="reference-situation-facts">
        {GENPLAN_FACTS.map(([title, text], index) => (
          <li key={title}>
            <span className="mono">{index + 1}</span>
            <div><strong>{title}</strong><p>{text}</p></div>
          </li>
        ))}
      </ol>
    </div>
  )
}
