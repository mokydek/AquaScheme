# Ключи, ожидающие казахского перевода

Список для владельца словаря. Русские и английские значения написаны, казахские
намеренно НЕ заполнены: придуманный технический термин в проектном интерфейсе
хуже отсутствия перевода, а `fallbackLng: 'ru'` даёт для непереведённого ключа
ровно то же поведение, что было при зашитой строке.

Файл для правки — `frontend/src/i18n/locales/kk.ts`. Русские значения смотреть
в `frontend/src/i18n/locales/ru.ts`.

Добавлено 07.08.2026 при снижении долга зашитого текста с 198 до 86 строк.

## project.situationScheme (37 ключей)

Ситуационная схема и инженерная трасса.

`title`, `viewsLabel`, `hint`, `routeStatus`, `algorithmUnknown`, `cancel`,
`outlet`, `thPoint`, `thFlow`, `layerAudit`, `thLayer`, `thLines`, `thPoints`,
`thEntities`, `thTexts`, `noNetwork`, `thNode`, `thChainage`, `thGround`,
`thInvert`, `thDepth`, `profileBlocked`, `thSystem`, `redLines`, `utilities`,
`roads`, `water`, `outsideCorridor`, `noBlockers`, `referenceNote`,
`refCoverage`, `axisCoverage`, `meanDeviation`, `maxDeviation`, `hausdorff`,
`targetMissed`, `noReferenceAxis`

## project.gravity (25 ключей)

Самотёчный расчёт К1/К2. К уже существующему разделу добавлены:

`freezingTitle`, `geologyCoverageTitle`, `feasibilityTitle`, `thBasin`,
`thFrom`, `thTo`, `thLength`, `thBasinDepth`, `thEnd`, `noBasins`,
`stormTitle`, `manualFlowsNote`, `thCatchment`, `thArea`, `thTravelTime`,
`thFlowCal`, `thStatus`, `noCatchments`, `dropWellsTitle`, `thDropNode`,
`thDropChainage`, `thDrop`, `thDropDiameter`, `thDropDecision`, `thDropBasis`

Отдельно из задачи 1: `exportPlanSheets`, `planSheetsEmpty`, `thPlanned`.

## project.albumSheets (18 ключей + 5 статусов)

Набор рабочих листов альбома.

`registryTitle`, `composition`, `autoDownload`, `exportBlocked`, `reset`,
`sheetPdf`, `sheetDxf`, `topography`, `frame`, `blockers`, `noBlockers`,
`sheetSources`, `sheetHash`, `statusesLabel`, `servicePagesLabel`,
`registryLabel`, `previewControls`, `sheetStatus`

`status.blocked`, `status.preliminary`, `status.calculated`, `status.verified`,
`status.stale` — подписи статуса листа. Раньше подставлялись выражением в
фигурных скобках, поэтому аудит их не считал, а показывались они всё равно
по-русски.

## project.geology (19 ключей)

Геология и глубина промерзания.

`gwDepth`, `gwAbsolute`, `gwRise`, `thIge`, `thSoil`, `thFrom`, `thThickness`,
`noXlsxColumns`, `frostSource`, `maxOffset`, `coverageSource`,
`frostConfirmed`, `coverageConfirmed`, `frostBlocker`, `coverageBlocker`,
`frostValueHint`, `frostSourceHint`, `offsetHint`, `coverageSourceHint`

## project.import (13 ключей)

Импорт исходного чертежа.

`recognised`, `useAsGuide`, `confirmMissing`, `confirmMissingHint`,
`noBuildings`, `noCorridor`, `lnsX`, `lnsY`, `lnsFlow`, `lnsHead`, `cancel`,
`manualAxis`, `manualAxisHint`

## project.topo (3 ключа)

Из задачи 1, выбор поверхности: `surfaceLabel`, `surfaceExisting`,
`surfaceDesign`.

## project.provenanceAudit (1 ключ)

Из задачи 1: `limitedBy` — слабейшее звено аудита происхождения.

## Термины, требующие решения владельца

Отдельного внимания просят понятия, у которых русский вариант сам по себе
жаргонный и калька на казахский была бы неверной:

- **лоток** (`thInvert`) — отметка низа трубы, не «поднос»;
- **пикетаж** (`thChainage`) — расстояние по оси от начала трассы;
- **стоп-фактор** (`blockers`) — причина, по которой лист нельзя выпустить;
- **УГВ** (`gwDepth`) — уровень грунтовых вод;
- **ИГЭ** (`thIge`) — инженерно-геологический элемент;
- **ЛНС** (`lnsX`, `lnsY`, `lnsFlow`, `lnsHead`) — локальная насосная станция;
- **врезка**, **перепадный колодец**, **футляр** — встречаются в текстах
  движка, которые в словари пока не вынесены вовсе.

## Пополнение от 07.08.2026 (второй заход, 86 → 25)

### project.preview (15 ключей)

Предпросмотр рабочего листа: `sewerNetworks`, `status`, `noPlanGeometry`,
`incompletePlan`, `incompletePlanHint`, `sheetPosition`, `legendAxis`,
`legendUtilities`, `legendRedLines`, `noNetworkGeometry`, `noProfileStations`,
`needManholeCatalog`, `noGridParams`, `gridFromCard`, `billRecomputed`

### project.liveMap (11 ключей)

Карта ситуации: `mapLabel`, `whySegment`, `lns`, `designNetwork`,
`gravityCollector`, `outletConnection`, `pressureMain`, `rightOfWay`,
`loadingMap`, `gridConfirmed`, `notGeoreferenced`

### project.manholeCatalog (11 ключей)

`title`, `fileLabel`, `hint`, `template`, `thType`, `thPipeRange`, `thDepth`,
`thChamber`, `thSource`, `thStatus`, `migrationHint`

### project.pipeCalc (10 ключей)

`title`, `summary`, `thPipe`, `thLength`, `thFlow`, `thDiameter`, `thSlope`,
`thVelocity`, `thCheck`, `note`

### project.scheme (5), project.basis (5), project.hydraulics (4)

`legend`, `legendBase`, `legendCorridor`, `legendOutlet`, `legendRightOfWay`;
`object`, `code`, `client`, `apz`, `address`; `sourceLevel`, `requiredLevel`,
`minReserve`, `governingNode`

### project.deliverables (7) и project.gravity (7) — из задач 1 и 2

`basinLayout`, `basinLayoutPerBasin`, `basinLayoutContinuous`, `pressureLink`,
`pressureLinkSame`, `pressureLinkSeparate`, `notChosen`, `basinHint`;
`linksTitle`, `thLift`, `thLiftHeight`, `thHeadloss`, `thRequiredHead`,
`thPump`, `pumpPicked`

### Ещё термины на решение владельца

К прежнему списку добавляются: **АПЗ** (`basis.apz`) — архитектурно-плановое
задание; **условный горизонт** и **боковик** профиля; **полоса отвода**
(`liveMap.rightOfWay`); **перемычка** в значении напорного участка между
бассейнами (`gravity.linksTitle`).

## Пополнение от 07.08.2026 (третий заход, 25 → 14)

Вынесены строки, которые инженер видит в работе: `project.page` (4),
`errorBoundary` (4 — раздел вне `project`, потому что граница ошибок стоит выше
проекта), `project.zoom` (3). Из задач этого захода — `project.conditions` (4),
`project.tu` (18), `project.reconstruction.widthConfirm` и `widthSource`,
`project.gravity.thLinkLength`, `thLinkDiameter`, `derivedMark`.

Граница ошибок — классовый компонент, хук перевода в нём недопустим, поэтому
она обращается к экземпляру i18next напрямую.

### Что осталось невынесенным и почему — 14 строк в 8 файлах

- **`landing/NetworkFigure.tsx` (5)** — подписи внутри декоративного SVG на
  лендинге: «Сеть В1», номера узлов. Это иллюстрация, а не интерфейс работы;
  вынос дал бы ключи, которые никто не переведёт осмысленно в отрыве от
  картинки.
- **По 1–2 строки в шести секциях** — остатки, которые аудит видит как текст
  между тегами, а на деле это единицы измерения и разделители рядом с
  переменными («м», «·», «из»). Вынести их отдельными ключами значило бы
  породить словарь из предлогов; правильный путь — переписать сами строки на
  подстановки, и это стоит делать вместе с ближайшей правкой этих секций, а не
  отдельным заходом.

Уровень зафиксирован на 14. Правило прежнее: расти он не может.
