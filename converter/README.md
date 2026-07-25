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

## Деплой на Render (Docker)

1. Получите ссылку на .deb ODA File Converter (Linux) на
   opendesign.com/guestfiles/oda_file_converter (нужно принять лицензию).
2. Render → New → Web Service → выберите репозиторий, Root Directory `converter`,
   Environment `Docker`.
3. В Build настройках добавьте Build Arg `ODA_DEB_URL` со ссылкой из п.1.
4. Env: `CONVERT_PROVIDER=oda`, `ALLOWED_ORIGINS=https://<ваш-домен>.vercel.app`.
5. Deploy. Проверьте `https://<service>.onrender.com/ready`: нужен HTTP 200 и `"ok":true`.
6. Во Vercel фронтенда добавьте `VITE_CONVERTER_URL=https://<service>.onrender.com`
   и сделайте Redeploy. Тогда во фронтенде включатся DWG-выход (формат по
   умолчанию при экспорте) и DWG-вход (загрузка DWG в разделах импорта).

Запасной провайдер: `CONVERT_PROVIDER=cloudconvert` + `CLOUDCONVERT_API_KEY=...`.

Бесплатный тариф Render усыпляет сервис при простое: первая конвертация после
паузы занимает до минуты (холодный старт). Фронтенд корректно ждёт ответа; при
недоступном сервисе экспорт откатывается на DXF, а при загрузке DWG показывает
понятное сообщение (загрузите DXF или настройте сервис).
