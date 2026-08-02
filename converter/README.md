# AquaScheme converter (DWG ↔ DXF)

Небольшой микросервис конвертации чертежей, двусторонний (Обновление
требований 3): DXF → DWG на экспорт и DWG → DXF на импорт. Провайдер выбирается
конфигом (`CONVERT_PROVIDER`), так что его можно поменять без правки кода:

- `oda` (по умолчанию) — ODA File Converter, бесплатный инструмент Open Design
  Alliance, запускается headless под виртуальным X-сервером;
- `cloudconvert` — запасной вариант через CloudConvert API (интерфейс заложен).

## Endpoints

- `GET /health` — liveness процесса.
- `GET /ready` — реальная готовность провайдера; возвращает HTTP 503, если ODA не установлен.
- `POST /convert?to=dwg&version=ACAD2018` — multipart поле `file` (DXF) → DWG.
  Используется фронтендом при экспорте чертежей.
- `POST /convert?to=dxf` — multipart поле `file` (DWG) → DXF. Используется
  единым загрузчиком фронтенда: загруженный DWG конвертируется и дальше
  парсится как обычный DXF.

Исходный формат определяется по расширению файла, а без него — по сигнатуре
DWG (первые байты `AC10..`). Если файл уже в целевом формате, сервис возвращает
его без изменений.

## Локальный запуск

```bash
cd converter
npm install
npm start   # http://localhost:8080/health
```

Без установленного ODA File Converter `/convert` вернёт ошибку — это нормально,
пока не задан конвертер.

### Локальная конвертация конфиденциального DWG (Windows)

Топооснова реального объекта не должна уходить в публичный сервис, поэтому её
конвертируют на своей машине. Установите ODA File Converter и укажите путь к
исполняемому файлу:

```powershell
$env:ODA_CONVERTER_PATH = "C:\Program Files\ODA\ODAFileConverter 27.1.0\ODAFileConverter.exe"
$env:CONVERT_PROVIDER = "oda"
node src/index.js
```

Проверка: `GET http://localhost:8080/ready` должен вернуть `{"ok":true}`. Затем
во фронтенде задайте `VITE_CONVERTER_URL=http://localhost:8080` — загруженный
DWG будет конвертироваться локально и дальше разбираться как обычный DXF.

`ODA_CONVERTER_PATH` принимает либо путь к исполняемому файлу целиком (включая
пробелы, как в `C:\Program Files\…`), либо команду с обёрткой
(`xvfb-run -a ODAFileConverter` для Linux-деплоя). Разбор на команду и аргументы
происходит только тогда, когда значение само по себе не является исполняемым
файлом.

## Деплой на Render (Docker)

1. Получите ссылку на .deb ODA File Converter (Linux) на
   opendesign.com/guestfiles/oda_file_converter (нужно принять лицензию).
2. Render → New → Web Service → выберите репозиторий, Root Directory `converter`,
   Environment `Docker`.
3. В Render → Environment добавьте `ODA_DEB_URL`. Для закреплённого пакета
   `ODAFileConverter_QT6_lnxX64_8.3dll_27.1.deb` Dockerfile уже содержит
   проверенную SHA-256
   `c71363cd54758177af47a365154f180dc50a1e2b52a131994fda541c13a36766`.
   Если выбираете другую версию пакета, скачайте её один раз в доверенной среде,
   вычислите SHA-256 и добавьте `ODA_DEB_SHA256`. Render передаёт переменные
   Docker-сервиса как build args; несовпадение контрольной суммы останавливает
   сборку. В PowerShell сумму можно получить командой
   `(Get-FileHash -Algorithm SHA256 -LiteralPath "C:\\path\\oda.deb").Hash`;
   в Linux — `sha256sum oda.deb`. Используйте исходный guest URL ODA, а не
   краткоживущий адрес после редиректа и не URL со встроенным логином или
   токеном.
4. Настройте env:
   - `CONVERT_PROVIDER=oda`;
   - `ALLOWED_ORIGINS=https://<production>.vercel.app,https://<custom-domain>` —
     точные production/custom origins без путей;
   - для Preview Deployment дополнительно
     `ALLOWED_VERCEL_PREVIEWS=<project-slug>:<team-slug>`.
   - `MAX_CONCURRENT_CONVERSIONS=1` и `CONVERSION_REQUESTS_PER_MINUTE=6`
     ограничивают нагрузку на ODA. В production `/convert` также требует
     разрешённый browser `Origin`; health/ready остаются доступны мониторингу.
   Docker-образ уже содержит безопасные значения для текущих доменов проекта:
   `https://aqua-scheme-theta.vercel.app` и
   `aqua-scheme:mokydeks-projects`. При смене домена переопределите их в Render.
5. После изменения этих переменных выберите в Render **Save, rebuild, and
   deploy**, чтобы сервис собрал новый Docker-образ, а не перезапустил старый.
   В логе проверки пакета должна появиться строка `/tmp/oda.deb: OK`. Затем
   проверьте `https://<service>.onrender.com/ready`: нужен HTTP 200 и
   `"ok":true`.
6. Во Vercel фронтенда добавьте `VITE_CONVERTER_URL=https://<service>.onrender.com`
   и сделайте Redeploy. Тогда во фронтенде включатся DWG-выход (формат по
   умолчанию при экспорте) и DWG-вход (загрузка DWG в разделах импорта).

Запасной провайдер: `CONVERT_PROVIDER=cloudconvert` + `CLOUDCONVERT_API_KEY=...`.

Бесплатный тариф Render усыпляет сервис при простое: первая конвертация после
паузы занимает до минуты (холодный старт). Фронтенд корректно ждёт ответа; при
недоступном сервисе экспорт откатывается на DXF, а при загрузке DWG показывает
понятное сообщение (загрузите DXF или настройте сервис).

## CORS

Политика закрыта по умолчанию в production: если список не задан, браузерные
запросы получают `403 CORS_ORIGIN_DENIED`. Health checks, `curl` и другие
server-to-server запросы без заголовка `Origin` продолжают работать.

- `ALLOWED_ORIGINS` — разделённый запятыми список **точных** origins, например
  `https://aqua-scheme-theta.vercel.app,https://example.kz`. Допустим только
  `http://`/`https://`; wildcard `*`, путь, query и fragment запрещены.
- `ALLOWED_VERCEL_PREVIEWS` — необязательный список пар
  `<project-slug>:<team-slug>`. Он разрешает только HTTPS preview-адреса вида
  `<project>-<deployment-or-branch>-<team>.vercel.app`. Постоянный production
  alias всё равно указывается точно в `ALLOWED_ORIGINS`.
- `ALLOW_LOCALHOST` — `true`/`false`. По умолчанию loopback origins
  (`localhost`, `127.0.0.1`, `[::1]` с любым портом) разрешены только вне
  production. Docker image уже задаёт `NODE_ENV=production`; при Native Runtime
  на Render также задайте `NODE_ENV=production`.

Пример Render:

```env
NODE_ENV=production
ALLOWED_ORIGINS=https://aqua-scheme-theta.vercel.app
ALLOWED_VERCEL_PREVIEWS=aqua-scheme:mokydeks-projects
ALLOW_LOCALHOST=false
MAX_CONCURRENT_CONVERSIONS=1
CONVERSION_REQUESTS_PER_MINUTE=6
```

Если Preview URL не нужен, не задавайте `ALLOWED_VERCEL_PREVIEWS`. Самый строгий
вариант — добавлять каждый разрешённый preview URL точно в `ALLOWED_ORIGINS`.
