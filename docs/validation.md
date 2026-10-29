# Проверка 29 октября 2026

Проверено в текущем Linux-окружении, Node 24, pnpm 10.30.3, PostgreSQL 16 и системный Chromium.

| Проверка | Результат |
| --- | --- |
| Frozen dependency install, SVG→PNG/ICO/ICNS | Успешно |
| TypeScript, ESLint, production build всех приложений | Успешно |
| Vitest API | 15/15, включая 3 сценария реальной PostgreSQL |
| Vitest launcher | 10/10: IPC-входные данные, редактирование секретов в логах, обнаружение повреждённых загрузок |
| Vitest shared | 2/2 |
| Prisma generate, migrate deploy, повторный migrate, seed | Успешно |
| Playwright | Лендинг, мобильный экран, темы; регистрация, HttpOnly cookie, восстановление сессии, email verification, неверный/верный пароль |
| Настоящий Electron headless | Main, preload, renderer, IPC, сохранение/удаление профиля работают |
| Linux unpacked package | Собран с исправленными XMCL-зависимостями |
| Docker web | Собран; HTML Auralis получен из запущенного nginx |
| Docker API | Заблокирован HTTP403 binaries.prisma.sh при bootstrap Prisma в чистом образе |
| Windows NSIS | Доходит до генерации деинсталлятора; остановлен отсутствием Wine в Linux |
| macOS DMG | Не запускался: нужен macOS runner |
| Microsoft-вход, Minecraft, системное хранилище на Windows/Mac, автообновления | Требуют лицензионного аккаунта, доступа к внешним сервисам и целевых ОС |
| Подпись и Apple notarization | Не выполнялись: сертификаты не предоставлены |
| GitHub Actions / Releases | Настроены, но не запускались и не публиковались |

Исправлены ошибки публикации последних XMCL-пакетов: закреплены совместимые `@xmcl/core@2.15.1`, `@xmcl/installer@6.1.2`, `@xmcl/unzip@2.1.2`. В React Strict Mode подтверждение email теперь использует один общий запрос, чтобы одноразовый токен не потреблялся дважды.

Runtime Prisma использует JS query compiler и adapter-pg. Для миграций Prisma6.19 есть документированный CLI wrapper для PostgreSQL catalog name→text; `migrate dev` с shadow database отдельно не проверен. CLI bootstrap в чистой машине всё ещё может загружать engine-файлы, поэтому разрешение binaries.prisma.sh необходимо. Проверки TLS и контрольных сумм сохранены.

В черновике среды сохранены install_script, start_skill и дополнительные сетевые домены. Сохранение черновика не применяет политику сети и не публикует snapshot: изменения нужно сохранить в настройках среды и затем опубликовать. Восстановление в новой задаче не проверялось.
