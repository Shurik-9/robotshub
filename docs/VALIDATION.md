# Проверки перед передачей

## Автоматический контроль

В чистой копии из `scripts/export-review-repo.sh` выполните:

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

Последний `curl` проверяет HTTP и SPA fallback; браузерный тест проверяет расчёт и отчёт именно в собранном контейнере. Для браузерных тестов установите Chromium/Chrome или задайте `CHROMIUM_PATH` к исполняемому файлу. GitHub Actions установит Chrome самостоятельно. Дополнительный ручной маршрут описан в [REVIEWER_GUIDE.md](REVIEWER_GUIDE.md).

## Критерии готовности

- Сборка завершается с закреплённым lockfile и не требует переменных Replit или секретов.
- `docker compose ps` показывает работающий `web` со статусом healthy.
- Главная, данные карты и внутренние URL отдаются по HTTP.
- В браузере карта, каталог, описание объекта и сохранение данных работают без ошибок консоли.
- В репозитории нет `.env` с секретами, истории Replit, загруженных архивов и полных текстов сторонних исследований; права на ресурсы сайта проверены перед публикацией.

Если Docker недоступен на машине разработчика, успешная сборка Vite и локальный запуск **не равны** проверке контейнера. Такой случай нужно честно указать при передаче, а не отмечать Docker как проверенный.