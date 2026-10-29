# Сборка и публикация Auralis

## Установщики

Проект создаёт NSIS `.exe` для Windows 11 x64 и `.dmg` для MacBook с Apple Silicon
(M1 и новее, arm64). Файлы появляются в `apps/launcher/release/`.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm assets
# На Windows:
pnpm dist:win
# На macOS:
pnpm dist:mac
```

`.dmg` нужно собирать на macOS: используются системные инструменты Apple. Команда
`dist:mac` явно выбирает arm64, в том числе на Intel Mac. CI выполняет её на
`macos-14`; Windows собирается на `windows-latest`. Запуск игры, drag-to-Applications,
ярлыки, деинсталляцию и обновление требуется дополнительно проверить на реальных ОС.

В GitHub Actions запустите **Desktop installers → Run workflow** для тестовых сборок.
Установщики и SHA-256 доступны в артефактах завершённого запуска. Для релиза обновите
версии пакетов и создайте тег, совпадающий с версией лаунчера, например `v0.1.0`.
Workflow проверит проект, соберёт обе ОС и только после успешных сборок создаст
GitHub Release. Публикация релиза не запускается при ручном workflow_dispatch.

Метаданные `latest.yml`, `latest-mac.yml`, blockmap и macOS ZIP публикуются вместе
с установщиками: они нужны `electron-updater`. Не удаляйте их из релиза. Репозиторий
из `electron-builder.yml` должен совпадать с фактическим репозиторием релизов.

## Подпись Windows

Для распространения используйте сертификат подписи кода доверенного центра.
Workflow поддерживает PFX через electron-builder. Добавьте в GitHub **Settings →
Secrets and variables → Actions**:

- `WIN_CSC_LINK`: base64 PFX или защищённый URL сертификата, поддерживаемый electron-builder;
- `WIN_CSC_KEY_PASSWORD`: пароль сертификата.

Современные EV/OV сертификаты часто хранят ключ в аппаратном устройстве или облачном
HSM. Для них потребуется отдельная интеграция поставщика подписи (например, Azure
Trusted Signing) вместо PFX; её нельзя заменить выдуманным экспортом сертификата.
Без сертификата получается неподписанный тестовый установщик. SmartScreen может
показывать предупреждение и для нового подписанного приложения без репутации.
Проверяйте источник и SHA-256, прежде чем подтверждать запуск тестовой сборки.

## macOS: Developer ID и нотариализация

Нужны Apple Developer Program, сертификат **Developer ID Application** с закрытым
ключом и разрешение на нотариализацию. Экспортируйте P12 в защищённое хранилище CI,
затем добавьте секреты:

- `MAC_CSC_LINK`: base64 P12 или поддерживаемый electron-builder защищённый URL;
- `MAC_CSC_KEY_PASSWORD`: пароль P12;
- `APPLE_ID`: Apple ID;
- `APPLE_APP_SPECIFIC_PASSWORD`: пароль приложения Apple ID;
- `APPLE_TEAM_ID`: идентификатор команды Apple.

Сборка использует hardened runtime, entitlements и afterSign hook. Нотариализация
выполняется при наличии трёх переменных Apple; неполный набор должен приводить к
ошибке, а не к молчаливому релизу без нотариализации. Проверьте готовый файл:

```sh
codesign --verify --deep --strict --verbose=2 /Applications/Auralis.app
spctl --assess --type execute --verbose /Applications/Auralis.app
xcrun stapler validate /Applications/Auralis.app
```

Без Apple Developer ID macOS-сборка предназначена для тестирования. Gatekeeper
может заблокировать её. После проверки источника и хеша используйте **System
Settings → Privacy & Security → Open Anyway**, если macOS предлагает эту кнопку.
Не отключайте Gatekeeper глобально. Корпоративная политика может запрещать запуск.

## Локальный Docker

`docker compose up --build -d` запускает PostgreSQL, API и собранный сайт. Сайт
доступен на порту 5174, API на 3001, PostgreSQL на 5432; внешние порты привязаны
только к loopback. API применяет имеющиеся миграции перед стартом. Для разработки
с hot reload поднимите только БД (`docker compose up -d postgres`), а API и Vite
запускайте через `pnpm dev` на хосте. Не запускайте одновременно второй сервер
на тех же портах.

В управляемой облачной среде для сборки через прокси нужен CA, не отключение TLS:

```sh
docker build --secret id=proxy_ca,src="$CODEX_PROXY_CERT" -f apps/api/Dockerfile -t auralis-api .
docker build --secret id=proxy_ca,src="$CODEX_PROXY_CERT" -f apps/web/Dockerfile -t auralis-web .
```

Обычные локальные Docker-сборки используют системное хранилище доверия без этого
необязательного секрета. Сертификат прокси не копируется в слои образа.

## Продакшен и HTTPS

1. Направьте DNS `APP_DOMAIN` на сервер; откройте TCP 80/443 и при необходимости UDP 443.
2. Скопируйте `deploy/.env.example` в корневой `.env`, задайте собственные секреты и SMTP.
   Для пароля PostgreSQL используйте hex или URL-safe символы, поскольку он входит в URI.
3. Выполните `docker compose -f docker-compose.prod.yml up --build -d`.
4. Проверьте `docker compose -f docker-compose.prod.yml ps` и запросите
   `https://<ваш-домен>/api/health`; ответ должен подтверждать подключение к БД.
5. Проверьте регистрацию, доставку письма, подтверждение email, вход и отзыв сессии.

Caddy получает и обновляет HTTPS-сертификат. API доступен через тот же origin, что
и сайт, с HttpOnly/Secure/SameSite refresh cookie. Caddy направляет `/api/*` сразу
в API: включённый `TRUST_PROXY` соответствует ровно одному прокси. БД и API не
публикуют порты наружу. SMTP обязателен в production; тестовый mailbox отключён.
Перед обновлением делайте резервную копию; миграции применяются автоматически и
могут требовать плана отката. Не масштабируйте процесс миграции параллельно.

## Резервное копирование

```sh
sh deploy/backup.sh /secure/backup-directory
# Проверка структуры дампа:
docker compose -f docker-compose.prod.yml exec -T postgres pg_restore --list < /secure/backup-directory/auralis-TIMESTAMP.dump
```

Запускайте резервирование по расписанию, шифруйте и переносите копии вне сервера,
задайте срок хранения и регулярно проверяйте восстановление на отдельной БД.
Дамп содержит email, хеши паролей, сессии и другие персональные данные.
Для восстановления в **отдельную пустую тестовую БД**:

```sh
docker compose -f docker-compose.prod.yml exec -T postgres \
  sh -c 'exec pg_restore --exit-on-error --no-owner -U "$POSTGRES_USER" -d auralis_restore_test' \
  < /secure/backup-directory/auralis-TIMESTAMP.dump
```

Сначала создайте `auralis_restore_test` отдельно; не подставляйте рабочую БД без
согласованного плана восстановления. Volume `postgres_data` нельзя считать
резервной копией. Не выполняйте `docker compose down -v` для рабочей БД.
