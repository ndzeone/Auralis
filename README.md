# Auralis

**Ваш следующий мир начинается здесь.** Лаунчер Minecraft Java Edition для Windows 11 x64 и macOS Apple Silicon, сайт и сервис аккаунтов.

Независимый проект, не связанный с Mojang или Microsoft. Для игры нужен Microsoft-аккаунт с приобретённой Minecraft Java Edition. Аккаунт Auralis не заменяет лицензию. Проверка товарного знака Auralis не проводилась.

## Архитектура

```text
apps/
  launcher/        Electron main + sandboxed preload + React/Vite renderer
    electron/      Minecraft, Microsoft authentication, encrypted local storage, IPC
    build/         Windows/macOS icons, DMG background, entitlements, notarization
  api/             Express, Zod, argon2id, JWT, PostgreSQL/Prisma
    prisma/        Schema, SQL migrations, deterministic news seed
  web/             React/Vite, Tailwind, landing page and account dashboard
packages/shared/   Shared Zod schemas and five themes (CSS design tokens)
branding/          Original SVG logo and DMG background
scripts/           Reproducible icon generation
deploy/            HTTPS reverse proxy and database backup script
.github/workflows/ Validation and native installer build/release
```

React не имеет доступа к Node.js. Привилегированные операции идут через ограниченный `window.auralis` в preload. Minecraft и системные токены хранятся на компьютере пользователя, API обслуживает только аккаунты Auralis, настройки и профили. Модель БД и ER-диаграмма: [docs/database.md](docs/database.md).

## Этап 1. Подготовка

Нужны Node.js 22 или 24, Corepack, Docker с Compose; для GUI — Windows 11 или macOS 12+ на Apple Silicon. Каждая облачная задача уже изолирована: используйте текущий checkout, отдельный Git worktree не нужен.

```sh
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm assets
cp .env.example .env
cp apps/api/.env.example apps/api/.env
```

В `apps/api/.env` задайте `DATABASE_URL`, отдельный `JWT_SECRET` (например, `openssl rand -hex 32`), `WEB_ORIGIN=http://localhost:5174` и `LAUNCHER_ORIGIN=http://localhost:5173`. Пароль PostgreSQL в `.env` и `DATABASE_URL` должен совпадать. `.env` не коммитится. В production нужны SMTP и HTTPS; перечень переменных указан в примере API. Секреты не передавайте в чат и не помещайте в Vite-переменные: всё с префиксом `VITE_` публично.

Проверка этапа: `corepack pnpm --version` должен показать `10.30.3`, установка не должна изменять lockfile.

## Этап 2. База данных, API и сайт

```sh
docker compose up -d postgres
corepack pnpm db:generate
corepack pnpm db:migrate
corepack pnpm db:seed
corepack pnpm dev
```

API работает на порту 3001, сайт на 5174. Проверка готовности — `GET /api/health`. Примеры маршрутов и настройка почты: [apps/api/README.md](apps/api/README.md).

Для разработки без почтового сервера есть явно включаемый `DEV_MAILBOX=true`: локальный предпросмотр писем. В production этот режим запрещён. Токены подтверждения и сброса пароля одноразовые; refresh-токены в БД хэшированы и ротируются. Access-токен сайта находится в памяти, refresh — в HttpOnly cookie. Картинки скинов проверяются и хранятся в PostgreSQL; это скины профиля Auralis, они не меняют скин официального Minecraft-аккаунта.

Проверка этапа: регистрация, подтверждение email, вход, обновление темы, список и отзыв сессий. API не должен принимать неправильный пароль или повторно использованный refresh-токен.

## Этап 3. Лаунчер

```sh
corepack pnpm dev:launcher
```

Откройте настройки, выберите Java, создайте профиль, войдите в Microsoft и нажмите «Играть». Microsoft использует код устройства; пароль не вводится в Auralis. Лаунчер устанавливает официальный vanilla-клиент, библиотеки и assets с проверкой хэшей через `@xmcl/installer`, запускает через `@xmcl/core`. Фактический список функций и ограничения Java описаны в [docs/limitations.md](docs/limitations.md).

Для просмотра интерфейса без desktop-окружения:

```sh
corepack pnpm --filter @auralis/launcher dev:web
```

В браузере запуск игры, Microsoft-вход и операции с файловой системой недоступны. Preview явно обозначает этот режим и не имитирует установку игры.

Проверка этапа: смена тем, сохранение профиля после перезапуска, отображение кода Microsoft, установка и запуск версии с подходящей Java, логи, остановка игры, открытие папки профиля. Для полного запуска нужен лицензионный аккаунт и доступ к Microsoft/Mojang; эти проверки не заменяет успешная сборка интерфейса.

## Этап 4. Проверки и установщики

```sh
corepack pnpm typecheck
corepack pnpm test
corepack pnpm lint
corepack pnpm build
# Требуют работающую тестовую PostgreSQL:
TEST_DATABASE_URL=postgresql://auralis:auralis_local_only@localhost:5432/auralis corepack pnpm --filter @auralis/api test
# Установить браузер один раз, затем проверить сайт с API:
corepack pnpm exec playwright install chromium
corepack pnpm test:e2e
```

`test` без `TEST_DATABASE_URL` запускает unit-тесты; интеграционные тесты БД отмечены как пропущенные. Не используйте production-базу для тестов. E2E-сценарии требуют PostgreSQL, миграций и окружения API, как на этапе 2.

На Windows:

```powershell
corepack pnpm dist:win
```

На macOS Apple Silicon:

```sh
corepack pnpm dist:mac
```

Артефакты находятся в `apps/launcher/release/`. NSIS позволяет выбрать каталог, создаёт ярлыки и деинсталлятор; DMG предлагает перенести приложение в Applications. DMG собирается на macOS. Native CI, подпись, нотаризация, автообновления и выпуск: [docs/release.md](docs/release.md). Наличие workflow не означает, что Actions уже выполнялся или опубликован релиз.

## Этап 5. Развёртывание

Локальный Docker Compose и production-конфигурация: [docs/deployment.md](docs/deployment.md). Production использует PostgreSQL, API, статический web и Caddy для HTTPS. Резервная копия базы включает аккаунты и скины. Сохраняйте копии вне диска сервера и проверяйте восстановление.

## Приёмка

- [ ] Frozen install, typecheck, тесты, lint и production build проходят.
- [ ] Миграции применяются на чистой БД, повторный seed не дублирует новости.
- [ ] Регистрация, подтверждение почты, восстановление пароля и отзыв сессии работают.
- [ ] Пять тем переключаются без перезагрузки; сайт работает на мобильном экране.
- [ ] Microsoft-вход и Minecraft проверены с лицензией на Windows 11 и Mac M1.
- [ ] Java соответствует выбранной версии Minecraft; загрузки проверяются по хэшам.
- [ ] NSIS install/uninstall проверен на Windows, DMG — на Mac.
- [ ] Production-пакеты подписаны, macOS notarization успешно завершена.
- [ ] Обновление с предыдущего релиза проверено с подписью и метаданными.

Это список приёмки продукта, а не заявление о выполненных проверках. Фактические результаты текущего прогона сохраняются в [docs/validation.md](docs/validation.md).
