# Развёртывание сайта, API и PostgreSQL

Лаунчер устанавливается отдельно; Windows `.exe` и macOS `.dmg` описаны в
[release.md](release.md). Эти контейнеры обслуживают регистрацию, аккаунты,
настройки, новости и сайт. Они не содержат Minecraft, Java или учётные данные игроков.

## Локальный стек

Нужны Docker Engine с Compose v2 и свободные порты 5432, 3001, 5174.

```sh
cp .env.example .env
docker compose up --build -d
docker compose ps
curl --fail http://localhost:3001/api/health
curl --fail http://localhost:5174/healthz
```

PostgreSQL должен стать healthy до старта API. API применяет миграции через
`prisma migrate deploy`, затем запускает скомпилированный сервер. Health endpoint
проверяет запрос к базе данных. Сайт отдаёт nginx; `/api/*` проксируются в API.
Все опубликованные локальные порты привязаны к `127.0.0.1`.

Compose собирает приложение, но не обеспечивает hot reload. Для разработки
используйте только контейнер БД и процессы Node на хосте:

```sh
docker compose up -d postgres
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:migrate
pnpm dev
```

Настройте `apps/api/.env` по его примеру, включая тот же `DATABASE_URL`, что и у
поднятой БД. При ошибке старта смотрите `docker compose logs api`; не удаляйте
volume для устранения миграционной ошибки. Для остановки используйте
`docker compose stop`; `down -v` удаляет БД и не подходит для хранения данных.

## Сборка в управляемой облачной среде

Интернет-доступ в этой среде идёт через предоставленный прокси. Docker использует
свои настройки прокси, а Node внутри сборки должен доверять сертификату сессии:

```sh
docker build --secret id=proxy_ca,src="$CODEX_PROXY_CERT" \
  -f apps/api/Dockerfile -t auralis-api .
docker build --secret id=proxy_ca,src="$CODEX_PROXY_CERT" \
  -f apps/web/Dockerfile -t auralis-web .
```

Dockerfile монтирует этот CA только на сетевых шагах через BuildKit secret и
задаёт `NODE_EXTRA_CA_CERTS`. Он не сохраняется в слоях. При обычной локальной
сборке secret необязателен. Для Compose в такой среде можно создать временный
override вне репозитория:

```yaml
services:
  api:
    build:
      secrets: [proxy_ca]
  web:
    build:
      secrets: [proxy_ca]
secrets:
  proxy_ca:
    file: ${CODEX_PROXY_CERT}
```

Примените его вместе с основным compose-файлом через `-f`. Не отключайте
проверку TLS и не копируйте сертификаты или учётные данные прокси в образы.

## Production

1. Выделите сервер с Docker, настройте DNS домена на его адрес и разрешите TCP 80/443.
2. Скопируйте `deploy/.env.example` в `.env` корня репозитория. Укажите домен,
   email для ACME, рабочий SMTP и отдельные случайные секреты PostgreSQL/JWT.
3. Используйте URL-safe пароль БД (например, `openssl rand -hex 32`), поскольку
   пароль входит в `DATABASE_URL`. JWT secret должен содержать минимум 32 символа.
4. Выполните команды:

```sh
docker compose -f docker-compose.prod.yml config --quiet
docker compose -f docker-compose.prod.yml up --build -d
docker compose -f docker-compose.prod.yml ps
```

Caddy автоматически выпускает и обновляет TLS-сертификат. Для HTTP/3 можно также
разрешить UDP 443. PostgreSQL и API не публикуют наружу порты. Для `/api/*` Caddy
направляет запрос прямо в API, поэтому `TRUST_PROXY=true` соответствует одному
доверенному reverse proxy. Сайт и API находятся на одном origin; refresh cookie
остаётся HttpOnly, Secure и SameSite. SMTP обязателен для подтверждения email и
восстановления пароля. Dev mailbox в production запрещён.

После старта запросите `https://<домен>/api/health`, зарегистрируйте тестовый аккаунт,
проверьте получение письма, вход и отзыв сессии. Добавьте внешнее наблюдение за
этим endpoint, местом на диске, сроком сертификата и результатами резервирования.
Перед обновлением создавайте резервную копию и изучайте миграции. Одновременное
применение миграций несколькими копиями API не настроено; для масштабирования
вынесите его в отдельный однократный deployment job.

## Резервные копии и восстановление

```sh
sh deploy/backup.sh /secure/auralis-backups
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_restore --list < /secure/auralis-backups/auralis-TIMESTAMP.dump
```

Скрипт создаёт `pg_dump -Fc`, сначала записывает временный файл с правами,
ограниченными `umask 077`, и переименовывает его только после успешного завершения.
Настройте расписание, шифрование, передачу вне сервера и срок хранения. Дамп
содержит персональные данные и хеши паролей. Периодически проверяйте восстановление
в отдельную пустую БД:

```sh
docker compose -f docker-compose.prod.yml exec -T postgres \
  sh -c 'createdb -U "$POSTGRES_USER" auralis_restore_test'
docker compose -f docker-compose.prod.yml exec -T postgres \
  sh -c 'exec pg_restore --exit-on-error --no-owner -U "$POSTGRES_USER" -d auralis_restore_test' \
  < /secure/auralis-backups/auralis-TIMESTAMP.dump
```

Пример предназначен для новой тестовой БД и не перезаписывает рабочую. Отдельно
защитите сертификаты и секреты сервера. Docker volume не заменяет резервную копию.
