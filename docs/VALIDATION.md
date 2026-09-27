# Дополнительные проверки

## Автоматический контроль

После клонирования репозитория при наличии Node.js 24, pnpm 10.26.1 и Docker Compose v2 выполните:

```bash
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm --filter @workspace/robotshub run test:map
pnpm --filter @workspace/robotshub run test:calc
pnpm --filter @workspace/robotshub run test:journey
pnpm --filter @workspace/robotshub run build
docker compose up --build --wait
curl -f http://localhost:8080/healthz
curl -f http://localhost:8080/map/map-data.json
curl -f 'http://localhost:8080/solutions'
OPERATION_ECONOMICS_BROWSER_URL=http://localhost:8080 pnpm --filter @workspace/robotshub run test:operation-economics
docker compose down
```

Последний `curl` проверяет HTTP и открытие внутреннего маршрута; браузерный тест проверяет расчёт и отчёт именно в собранном контейнере. Для браузерного теста нужен Chromium/Chrome или `CHROMIUM_PATH` с путём к исполняемому файлу. Основной запуск требует только Docker Compose: Node.js, pnpm и браузерные тесты нужны лишь для этих дополнительных проверок. Ручной маршрут описан в [REVIEWER_GUIDE.md](REVIEWER_GUIDE.md).

## Критерии готовности

- Сборка завершается с закреплённым lockfile и не требует секретов.
- `docker compose ps` показывает работающий `web` со статусом healthy.
- Главная, данные карты и внутренние URL отдаются по HTTP.
- В браузере карта, каталог, описание объекта и сохранение данных работают без ошибок консоли.

Успешная сборка Vite и локальный запуск **не равны** проверке контейнера.