# База данных и API Auralis

PostgreSQL 16+, Prisma 6.19. Схема: `apps/api/prisma/schema.prisma`.
Используется GA query compiler (`engineType="client"`) и официальный
`@prisma/adapter-pg`: запросы выполняет JavaScript-драйвер `pg`, без скачивания
нативных Rust-движков. `apps/api/prisma.config.ts` также включает JavaScript
адаптер миграций (в Prisma 6.19 эта часть CLI ещё помечена experimental).
Для одного каталожного запроса CLI `prisma.config.ts` приводит `relname` и
`nspname` к `text`: adapter-pg 6.19 не поддерживает PostgreSQL OID 19 (`name`).
Это не меняет схему приложения и не отключает проверки зависимостей.
`migrate deploy` и его повторный запуск проверены. `migrate dev` с отдельной
shadow database/introspection не проверен.
Все даты UTC, email и username нормализуются в нижний регистр. Username: 3–16
символов ASCII, цифры и `_`. Пароль: 12–128 символов.

```mermaid
erDiagram
  User ||--o{ Session : opens
  Session ||--o{ RefreshToken : rotates
  User ||--o{ EmailToken : receives
  User ||--o{ Profile : owns
  User ||--|| UserSettings : configures
  User ||--o| Skin : uploads
  User ||--o{ Cape : owns
  User ||--o{ AuditLog : generates
  User {
    string id PK
    string email UK
    string username UK
    string passwordHash
    datetime emailVerifiedAt
  }
  Session {
    string id PK
    string userId FK
    string deviceId
    datetime expiresAt
    datetime revokedAt
  }
  RefreshToken {
    string id PK
    string tokenHash UK
    string sessionId FK
    datetime usedAt
  }
  EmailToken {
    string tokenHash UK
    string purpose
    string userId FK
    datetime expiresAt
  }
  Profile {
    string id PK
    string userId FK
    string name
    string version
    int memoryMb
    string jvmArgs
  }
  News {
    string id PK
    string slug UK
    string title
    datetime publishedAt
  }
```

## Запуск

В корне загрузите `.env` через оболочку или передайте переменные окружения.
`dotenv` автоматически читает `.env` только в текущем рабочем каталоге процесса;
при запуске `pnpm --filter @auralis/api ...` это `apps/api`.

```sh
export DATABASE_URL=postgresql://auralis:auralis_local_only@localhost:5432/auralis
export JWT_SECRET="$(openssl rand -hex 32)"
export DEV_MAILBOX=true
pnpm --filter @auralis/api db:generate
pnpm --filter @auralis/api db:migrate
pnpm --filter @auralis/api db:seed
pnpm --filter @auralis/api dev
```

API по умолчанию слушает `127.0.0.1:3001`, для контейнера задайте `HOST=0.0.0.0`.
`GET /api/health` возвращает 200, только если PostgreSQL отвечает на `SELECT 1`.

`NODE_ENV=production` требует `JWT_SECRET` не короче 32 символов и `SMTP_HOST`.
`SMTP_PORT=465` включает TLS сразу; на других портах обязателен STARTTLS.
`SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` задаются через защищённое окружение.
TLS-проверка сертификатов не отключается. `WEB_ORIGIN` должен совпадать с HTTPS
origin сайта; `LAUNCHER_ORIGIN` — с origin Vite во время разработки.
Приложение Electron делает запросы из main-процесса без браузерного Origin.

## HTTP-контракт

Все пути имеют префикс `/api`. JSON-ошибка: `{ "error": "..." }`; ошибки
валидации также содержат `issues`. Даты в ответах — ISO 8601.

| Метод и путь | Тело / результат |
| --- | --- |
| `POST /auth/register` | `{email,username,password,deviceId,deviceName?}` → 201, `{user,accessToken,refreshToken,sessionId,verificationRequired,emailSent}` |
| `POST /auth/login` | `{login,password,deviceId,deviceName?}` → тот же ответ с токенами |
| `POST /auth/refresh` | `{deviceId,refreshToken?}`; иначе HttpOnly cookie → новая пара токенов |
| `POST /auth/logout` | Bearer-токен → 204, отзыв текущей сессии |
| `POST /auth/resend-verification` | Bearer-токен → `{ok:true}` |
| `POST /auth/verify-email` | `{token}` → `{ok:true}` |
| `POST /auth/forgot-password` | `{email}` → одинаковый ответ для существующих и неизвестных email |
| `POST /auth/reset-password` | `{token,password}` → `{ok:true}`, отзыв всех сессий |
| `GET /me` | Bearer → `{user:{id,email,username,emailVerifiedAt,createdAt,settings,skin}}` |
| `PATCH /me/settings` | Bearer + `{theme?,language?}` → `{settings}` |
| `PATCH /me/password` | Bearer + `{currentPassword,password}` → 204, отзыв всех сессий |
| `GET /me/sessions` | Bearer → `{sessions:[{id,deviceName,createdAt,lastUsedAt,expiresAt,current}]}` |
| `DELETE /me/sessions/:id` | Bearer → 204, только собственная сессия |
| `PUT /me/skin` | Bearer + `{dataUrl,model:"classic"|"slim"}` → `{skin:{id,model,url}}` |
| `GET /media/skins/:id.png` | PNG 64×32 или 64×64; максимум 64 KiB входных данных |
| `GET /profiles` | Bearer → `{profiles:[...]}` |
| `POST /profiles` | Bearer + `{name,version,memoryMb?,jvmArgs?,icon?}` → 201 `{profile}` |
| `PUT /profiles/:id` | Bearer + полный профиль → `{profile}` |
| `DELETE /profiles/:id` | Bearer → 204 |
| `GET /news` | `{news:[{id,slug,title,excerpt,body,publishedAt}]}` |

`deviceId` — стабильный случайный идентификатор устройства длиной 8–128 символов;
в БД хранится его SHA-256. Это дополнительная привязка, а не криптографическая
аттестация устройства. `deviceName` — читаемое название до 100 символов.

Access JWT действует 15 минут; сервер проверяет текущую сессию при каждом
авторизованном запросе. Refresh-токен действует до конца 30-дневной сессии,
хранится в БД только как SHA-256 и используется один раз. Повторное использование
отзывает всю сессию. Клиенты должны сериализовать refresh-запросы.
Браузер хранит access-токен только в памяти, refresh — в HttpOnly SameSite=Strict
cookie (Secure в production). Electron хранит токены через safeStorage.

В режиме разработки `DEV_MAILBOX=true` включает локальный
`GET /api/dev/mailbox` с письмами в памяти. Доступ возможен только с loopback,
production запрещает этот режим при старте. Письма содержат одноразовые ссылки:
не публикуйте этот endpoint и не направляйте на него публичный reverse proxy.
Без SMTP или dev mailbox регистрация возвращает `emailSent:false`; проверку
почты можно повторить через `/auth/resend-verification`. Письма и токены не
печатаются в журнал сервера. Успешная регистрация даёт сессию до подтверждения
email; поле `emailVerifiedAt` позволяет применять продуктовые ограничения.

Скин хранится в Auralis и доступен для превью. Он не изменяет официальный скин
Minecraft и не доставляется другим игрокам: для этого нужна отдельная интеграция
Minecraft Services с правами пользователя.

## Проверки

```sh
pnpm --filter @auralis/api test
pnpm --filter @auralis/api typecheck
pnpm --filter @auralis/api build
TEST_DATABASE_URL="$DATABASE_URL" pnpm --filter @auralis/api test
```

Без `TEST_DATABASE_URL` интеграционные тесты явно пропускаются. При его наличии
тест проверяет реальную регистрацию, Argon2id, ротацию и replay токенов, отзыв
сессий, профили, темы, сброс пароля и одноразовость ссылки. Он создаёт пользователя
со случайным именем и удаляет его после прогона. Используйте отдельную тестовую
БД с применёнными миграциями.

## Эксплуатационные ограничения

Rate limit хранится в памяти процесса: для нескольких API-реплик нужен общий
Redis-store и согласованная политика защиты от распределённого перебора.
`TRUST_PROXY=true` допустим только за одним доверенным reverse proxy с закрытым
прямым доступом к API. Очистку истёкших токенов/сессий следует запускать отдельным
заданием; использованные refresh-токены нужно сохранять до конца срока сессии,
чтобы продолжала работать защита от replay. При удалении пользователя связанные
сессии/профили/настройки/скин удаляются, а аудит обезличивается.
Миграция не создаёт администратора и не добавляет публичный endpoint записи
новостей; seed повторяемый и не изменяет существующую публикацию.
