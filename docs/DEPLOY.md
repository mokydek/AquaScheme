# Деплой на Vercel

Приложение уже лежит на GitHub: https://github.com/mokydek/AquaScheme
Осталось связать репозиторий с Vercel. Vercel сам собирает проект при каждом
пуше в ветку `main` и раздаёт его по постоянной ссылке.

## Что уже настроено в коде

Файл `vercel.json` в корне задаёт всё, что нужно для сборки монорепозитория:

- `installCommand: npm install` — ставит зависимости в корне (так находится
  внутренний пакет `@aquascheme/engine`);
- `buildCommand: npm run build` — собирает фронтенд;
- `outputDirectory: dist` — Vite складывает готовый сайт в корневой `dist`
  (`frontend/vite.config.ts`, `build.outDir: ../dist`), куда Vercel и смотрит;
- `rewrites` — все адреса (`/app`, `/auth`, ...) отдают `index.html`, иначе при
  обновлении страницы по прямой ссылке был бы 404.

## Шаги (делаются один раз)

1. Откройте https://vercel.com и нажмите **Sign Up**. Выберите **Continue with
   GitHub** и войдите тем же аккаунтом, где лежит репозиторий.
2. На дашборде нажмите **Add New... → Project**.
3. В списке репозиториев найдите **AquaScheme** и нажмите **Import**.
4. Vercel прочитает `vercel.json` сам. Ничего в разделе Build менять не нужно.
5. Раскройте **Environment Variables** и добавьте две переменные (значения
   возьмите из локального файла `frontend/.env`):

   | Name | Value |
   | --- | --- |
   | `VITE_SUPABASE_URL` | `https://dqeejdtwwwisptkexchj.supabase.co` |
   | `VITE_SUPABASE_ANON_KEY` | ваш anon public ключ |

   Это публичные значения, их можно вставлять. Секретный `service_role` ключ
   сюда НЕ добавляйте.
6. Нажмите **Deploy** и подождите 1-2 минуты. Появится ссылка вида
   `aquascheme.vercel.app`.

## После первого деплоя

- Каждый следующий `git push` в `main` автоматически пересобирает сайт.
- Скопируйте адрес сайта и добавьте его в Supabase: Dashboard → Authentication →
  URL Configuration → Site URL. Это нужно на будущее, если включите подтверждение
  почты.

## Важно про настройки проекта в Vercel

- **Root Directory** должен остаться пустым (корень репозитория), НЕ `frontend`.
  Иначе не установится внутренний пакет `@aquascheme/engine` из соседней папки.
- **Output Directory**: сборка кладётся в корневой `dist`. Если в дашборде
  включён Override для Output Directory, укажите `dist` (или выключите Override).

## Если сборка упала

Откройте вкладку **Deployments** → последний деплой → **Building** и прочитайте
лог. Частые причины:

- Забытая переменная окружения — приложение при старте показывает понятную
  ошибку про `VITE_SUPABASE_URL`.
- `No Output Directory ... "dist"` — смотрите пункт про Output Directory выше.
