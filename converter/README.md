# AquaScheme converter (DXF to DWG)

Небольшой микросервис: принимает DXF, возвращает DWG. Провайдер выбирается
конфигом (`CONVERT_PROVIDER`), так что его можно поменять без правки кода:

- `oda` (по умолчанию) — ODA File Converter, бесплатный инструмент Open Design
  Alliance, запускается headless под виртуальным X-сервером;
- `cloudconvert` — запасной вариант через CloudConvert API (интерфейс заложен).

## Endpoints

- `GET /health` — статус и активный провайдер.
- `POST /convert?version=ACAD2018` — multipart поле `file` (DXF) → DWG.

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
4. Env: `CONVERT_PROVIDER=oda`.
5. Deploy. Проверьте `https://<service>.onrender.com/health`.
6. Во Vercel фронтенда добавьте `VITE_CONVERTER_URL=https://<service>.onrender.com`
   и сделайте Redeploy. Тогда во фронтенде включится выбор формата DWG.

Запасной провайдер: `CONVERT_PROVIDER=cloudconvert` + `CLOUDCONVERT_API_KEY=...`.

Бесплатный тариф Render усыпляет сервис при простое: первая конвертация после
паузы занимает до минуты (холодный старт). Фронтенд корректно ждёт ответа и, если
сервис недоступен, предлагает скачать DXF.
