# Auralis API

Express + strict TypeScript, PostgreSQL и Prisma 6.19, Argon2id, короткие JWT и
одноразовые refresh-токены с ротацией, привязкой к устройству и отзывом сессий.
Контракт маршрутов, ER-диаграмма и ограничения: [docs/database.md](../../docs/database.md).

Из корня монорепозитория:

```sh
corepack pnpm install --frozen-lockfile
cp apps/api/.env.example apps/api/.env
docker compose up -d postgres
corepack pnpm --filter @auralis/api db:generate
corepack pnpm --filter @auralis/api db:migrate
corepack pnpm --filter @auralis/api db:seed
corepack pnpm --filter @auralis/api dev
```

В production настройте `DATABASE_URL`, постоянный случайный `JWT_SECRET` длиной
не менее 32 символов, `WEB_ORIGIN`, `SMTP_HOST` и параметры SMTP через защищённые
переменные окружения. При старте production API проверяет наличие JWT и SMTP.
В Docker нужен `HOST=0.0.0.0`; для локальной разработки по умолчанию loopback.
Готовность: `GET /api/health` выполняет настоящий запрос к БД.

`DEV_MAILBOX=true` разрешён только вне production и включает loopback-only
`GET /api/dev/mailbox`: одноразовые ссылки подтверждения email и сброса пароля
не печатаются в журнал. В production используется SMTP с TLS-проверкой.
Не публикуйте development mailbox через reverse proxy.

```sh
corepack pnpm --filter @auralis/api typecheck
corepack pnpm --filter @auralis/api build
corepack pnpm --filter @auralis/api test
TEST_DATABASE_URL=postgresql://auralis:auralis_local_only@localhost:5432/auralis \
  corepack pnpm --filter @auralis/api test
```

Без `TEST_DATABASE_URL` три интеграционных теста отмечаются skipped. С переменной
проверяются реальные PostgreSQL-записи, регистрация, подтверждение email,
одноразовость ссылок, вход, ротация refresh, обнаружение replay, отзыв JWT-сессии,
профили, темы и сброс пароля. Используйте отдельную тестовую БД с применёнными
миграциями; тест удаляет только собственного случайно названного пользователя.

Prisma работает через официальный JavaScript query compiler и `@prisma/adapter-pg`;
нативные Rust-движки не скачиваются. JavaScript migration engine в Prisma 6.19
помечен experimental. `prisma.config.ts` содержит локальную совместимость для
каталожного запроса мигратора: PostgreSQL-поля `name` приводятся к `text`, потому
что adapter-pg 6.19 не поддерживает их OID. `migrate deploy` и его повторный запуск
проверены; `migrate dev` с introspection/shadow DB отдельно не проверен.
Повторяемый основной workflow — сохранить SQL-миграцию и применить `db:migrate`.

Одна API-реплика использует in-memory rate limit. При масштабировании нужен
общий store. Скины сохраняются для Auralis-превью; официальный Minecraft-скин
не изменяется. Для лицензии и игры нужен отдельный Microsoft/Minecraft аккаунт.
