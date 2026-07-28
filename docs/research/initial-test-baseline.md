# Исходная тестовая база AquaScheme

Дата: 2026-07-29
Commit: `c529d50`
ОС/оболочка: Windows, PowerShell
Node.js: `v22.17.0`
npm: `10.9.2`

## Сводка

| Проверка | Результат |
| --- | --- |
| TypeScript frontend + engine | PASS |
| Engine Vitest | PASS — 53 файла, 311 тестов |
| Frontend shared Vitest | PASS — 2 файла, 6 тестов |
| Production frontend build | PASS |
| Converter syntax | PASS |
| Converter runtime | NOT READY — отдельные зависимости не установлены |
| Benchmark | SKIPPED с exit code 0 — отсутствует private manifest |
| Lint | Команды нет |
| Coverage | Команды/порога нет |
| Browser E2E | Нет |
| Supabase integration | Нет |
| DWG round-trip | Не выполнен |

## Выполненные команды

### 1. Git baseline

```powershell
git status --short
git branch --show-current
git log -5 --oneline
```

Результат:

- ветка `main`;
- HEAD `c529d50`;
- единственная исходная запись status — `?? tmp/`;
- отслеживаемых изменений до аудита нет.

### 2. TypeScript

Обычный вызов `npm` в PowerShell сначала был заблокирован локальной ExecutionPolicy (`npm.ps1` нельзя выполнить). Это не ошибка проекта. Повторный запуск через Windows launcher:

```powershell
npm.cmd run typecheck
```

Результат: PASS за 24.4 с.

Выполнены:

```text
@aquascheme/frontend: tsc --noEmit
@aquascheme/engine:   tsc --noEmit
```

### 3. Engine unit/integration probes

Согласно `CLAUDE.md` тесты выполнены в одном потоке:

```powershell
cd engine
npx.cmd vitest run --pool=threads --poolOptions.threads.singleThread
```

Результат:

```text
Test Files  53 passed (53)
Tests       311 passed (311)
Duration    10.22s (wall time команды 13.6s)
```

Самый долгий тест — локальный geology probe (~6.2 с). Он распознал только текстовую сводку приватного источника, но не доказал извлечение табличных скважин и слоёв. Точные площадочные значения намеренно не записываются в tracked-отчёт. Прохождение такого probe необходимо учитывать как ограниченную проверку импорта, а не как полную успешную оцифровку геологии.

### 4. Frontend shared tests

На базовом commit корневой `npm run test` запускал только workspace `engine`, поэтому два frontend-файла (шесть тестов) были проверены отдельно:

```powershell
npx.cmd vitest run frontend/src/shared/exporters.test.ts frontend/src/shared/projectAlbum.test.ts --pool=threads --poolOptions.threads.singleThread
```

Результат:

```text
Test Files  2 passed (2)
Tests       6 passed (6)
Duration    3.99s
```

Проверено:

- XLSX колодцев/труб/компонентов;
- векторный PDF открывается через pdfjs;
- количество страниц совпадает с динамическим реестром;
- A3 landscape;
- отдельный DXF для каждого зарегистрированного рабочего листа;
- blocked set не выпускается.

После baseline добавлена корневая команда `npm run test:all`, которая последовательно запускает engine, frontend, converter и unit-тесты visual-score. Числа выше сохранены как историческая исходная точка commit `c529d50`.

### 5. Production build

```powershell
npm.cmd run build
```

Первый запуск внутри ограниченного sandbox завершился ошибкой доступа esbuild к родительскому каталогу. Повторный запуск с разрешённым доступом к локальной файловой системе прошёл успешно:

```text
vite v7.3.6
2136 modules transformed
✓ built in 15.58s
wall time 30s including tsc
```

Крупные артефакты:

- `pdf.worker.min` ~1.38 MB;
- `pdfmake` ~1.01 MB;
- `vfs_fonts` ~0.86 MB;
- основной index chunk ~0.69 MB;
- hydraulics worker ~0.63 MB;
- ProjectPage ~0.48 MB;
- XLSX ~0.50 MB.

Build успешен, но budget/performance gate отсутствует.

### 6. Benchmark

```powershell
npm.cmd run benchmark
```

Результат: exit code 0, но сравнение пропущено:

```text
benchmark: конфиденциальные исходники недоступны на этой машине:
  - manifest.json
Скрипт пропущен (не ошибка)
```

Следовательно:

- SCORE не вычислен;
- 99% не подтверждены;
- regression gate фактически не действует в этом checkout.

### 7. Converter

Синтаксис:

```powershell
node --check converter/src/index.js
node --check converter/src/providers.js
```

Результат: PASS.

Runtime:

```powershell
cd converter
$env:PORT='18081'
node src/index.js
```

Результат: FAIL до старта HTTP-сервера:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'express'
```

Причина: `converter` не входит в корневые npm workspaces и его отдельный `npm install` не выполнялся. Поэтому `/health`, `/ready` и реальный DWG↔DXF round-trip не проверены. Dockerfile предусматривает собственный install и требует ODA `.deb`.

## Что текущая зелёная база не доказывает

1. Что production Supabase применил все миграции.
2. Что RLS/RPC работают с реальной пользовательской сессией.
3. Что converter имеет ODA и корректно преобразует предоставленный DWG.
4. Что все реальные PDF/XLSX/DWG импортируются без ручных исправлений.
5. Что output состоит из 61 требуемой страницы.
6. Что чертежи инженерно и визуально совпадают с эталоном на 99%.
7. Что интерфейс проходит полный браузерный сценарий после ошибок/повторных кликов.
8. Что код имеет заданное покрытие ветвей/строк.

## Минимальные следующие тестовые ворота

1. Добавить root `test:all`, включающий engine и frontend.
2. Добавить coverage с порогом не ниже 85% для новых модулей.
3. Поднять ephemeral Supabase/Postgres и применить весь migration chain дважды.
4. Проверить owner/foreign-user RLS и оба RPC.
5. Добавить converter health/ready и DXF→DWG→DXF round-trip fixture.
6. Добавить Playwright E2E полного проекта.
7. Добавить 61 page catalog/golden structure test и rendered visual diff.
8. Сделать отсутствие benchmark manifest ошибкой в приёмочном CI, но разрешённым skip в публичном CI.

## Состояние рабочего дерева после проверок до создания отчётов

```text
?? tmp/
```

Ни тесты, ни сборка не изменили отслеживаемые файлы.
