# Auralis web

Лендинг и кабинет Auralis: React, Vite, Tailwind CSS, общие токены тем, Framer Motion и ленивое 3D-превью skinview3d.

Из корня репозитория:

```sh
pnpm --filter @auralis/web dev
pnpm --filter @auralis/web typecheck
pnpm --filter @auralis/web build
```

API по умолчанию: `http://localhost:3001/api`. Для production перед сборкой задайте `VITE_API_URL=/api`, разместите сайт и API на одном origin с HTTPS. Для отдельного origin API должен разрешать origin сайта в CORS; refresh cookie требует корректной HTTPS/SameSite конфигурации.

Access JWT хранится только в памяти вкладки; refresh — HttpOnly cookie API. LocalStorage используется только для ID устройства и темы.

Кнопки скачивания получают действительные URL из последнего GitHub Release. Пока артефакты не опубликованы, сайт явно показывает отсутствие сборок. В интерфейсе нет выдуманных бинарных файлов или успешных загрузок. API GitHub ограничивает число анонимных запросов.

Регистрация/вход, проверка email и сброс пароля используют API. Ссылки из писем: `?action=verify&token=TOKEN` и `?action=reset&token=TOKEN`. Скин сохраняется в профиле Auralis; это не меняет скин лицензионного Minecraft.

Проверка перед публикацией: поднять PostgreSQL/API, зарегистрироваться, выйти/войти, перезагрузить страницу (refresh cookie), отозвать вторую сессию, проверить смену темы, загрузить PNG-скин и сменить пароль. Lighthouse 90+ — цель, требующая отдельного измерения в production; она не заявлена как проверенный результат.
