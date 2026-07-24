const SOURCE_FACTS = [
  ['Подоснова', 'Картографическая схема района Нура и оз. Большой Талдыколь из листа 2 альбома'],
  ['Источники', 'ОС III-6, ОС II-1, ОС III-8 и ОС III-4'],
  ['Трасса', 'Проектный водосбросной коллектор 2024-51-НК'],
  ['Диаметры', 'Ø1200, 2×Ø800, Ø1600 и основные участки Ø2000'],
  ['Сооружение', 'ЛНС — ливневая насосная станция'],
  ['Выпуск', 'Оголовок выпуска в водный объект'],
] as const

export function ReferenceSituationView() {
  return (
    <div className="reference-situation">
      <figure className="reference-situation-sheet">
        <figcaption>
          <strong>Ситуационная схема</strong>
          <span>2024-51-НК · исходный альбом · лист 2</span>
        </figcaption>
        <ZoomPanSurface label="Масштабируемая ситуационная схема из исходного альбома">
          <img
            src="/reference/2024-51-situation.png"
            alt="Ситуационная схема коллектора 2024-51-НК из исходного проектного альбома"
          />
        </ZoomPanSurface>
      </figure>
      <ol className="reference-situation-facts">
        {SOURCE_FACTS.map(([title, text], index) => (
          <li key={title}>
            <span className="mono">{index + 1}</span>
            <div><strong>{title}</strong><p>{text}</p></div>
          </li>
        ))}
      </ol>
    </div>
  )
}
import { ZoomPanSurface } from './ZoomPanSurface'
