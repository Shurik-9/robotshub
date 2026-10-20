# Дополнительные проверки

## Автоматический контроль

После клонирования репозитория при наличии Node.js 24, pnpm 10.26.1 и Docker Compose v2 выполните:

```bash
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm --filter @workspace/robotshub run test:map
pnpm --filter @workspace/robotshub run test:calc
pnpm --filter @workspace/robotshub run test:journey
pnpm --filter @workspace/robotshub run test:questionnaire
pnpm --filter @workspace/robotshub run build
docker compose up --build --wait
curl -f http://localhost:8080/healthz
curl -f http://localhost:8080/map/map-data.json
curl -f 'http://localhost:8080/solutions'
curl -f http://localhost:8080/sitemap.xml
curl -f http://localhost:8080/sitemap-pages.xml
curl -f http://localhost:8080/news/sitemap.xml
curl -f http://localhost:8080/news
OPERATION_ECONOMICS_BROWSER_URL=http://localhost:8080 pnpm --filter @workspace/robotshub run test:operation-economics
docker compose down
```

Последний `curl` проверяет HTTP и открытие внутреннего маршрута; браузерный тест проверяет расчёт и отчёт именно в собранном контейнере. Для браузерного теста нужен Chromium/Chrome или `CHROMIUM_PATH` с путём к исполняемому файлу. Основной запуск требует только Docker Compose: Node.js, pnpm и браузерные тесты нужны лишь для этих дополнительных проверок. Ручной маршрут описан в [REVIEWER_GUIDE.md](REVIEWER_GUIDE.md).

## Критерии готовности

Отдельные регрессии новостей:

```bash
pnpm --filter @workspace/api-server run test:news-seo
# Нужен установленный nginx в PATH; проверка не запускает Docker.
pnpm --filter @workspace/api-server run test:news-proxy
```

Вторая проверка поднимает настоящий nginx с конфигурацией из `deploy/nginx.conf` (меняя только локальные порты, корень файлов и адрес upstream) и автономный сервер новостей на временной базе. Она проходит всю цепочку карт и страницы саммари, проверяет модерацию через прокси и сохранение публикации после перезапуска. Это не заменяет сборку самих Docker-образов.

- Сборка завершается с закреплённым lockfile и не требует секретов.
- `docker compose ps` показывает работающие `web` и `news` со статусом healthy.
- `/sitemap.xml` ссылается на обе карты; `/news/sitemap.xml` возвращает XML, не SPA HTML. В пустой базе корректен пустой `urlset`.
- После публикации новости её `/news/:id` открывается на том же домене и появляется в карте; после скрытия/удаления исчезает из карты и возвращает 404. Перезапуск `news` не теряет записи. Для модерации нужен необязательный `ADMIN_TOKEN`.
- Главная, данные карты и внутренние URL отдаются по HTTP.
- В браузере карта, каталог, описание объекта и сохранение данных работают без ошибок консоли.

Успешная сборка Vite и локальный запуск **не равны** проверке контейнера.

## Проверка обновлённого комплекта, 20 октября 2026

Дополнительные регрессии входного сценария, DOCX и связей каталога:

```bash
node --test artifacts/robotshub/scripts/test-start-value.mjs \
  artifacts/robotshub/scripts/test-start-workbench.mjs \
  artifacts/robotshub/scripts/test-solution-connections.mjs \
  artifacts/robotshub/scripts/test-questionnaire.mjs
```

Проверяются также `/glossary/`, `/news`, `/api/news`, `/cabinet`, `/lead` и `/api/cabinet/auth/me` через Docker nginx. Отсутствие авторизации для защищённых запросов должно возвращать отказ, а не HTML приложения с HTTP 200. Контейнеры проверяются без рабочих секретов и без импорта рабочей базы.

Результаты текущего запуска:

- Общая проверка типов `pnpm run typecheck` — успешно.
- Входной сценарий, DOCX, связи моделей и XLSX — 36/36 тестов.
- SEO новостей — 3/3; отдельная интеграционная проверка nginx/новостей — 1/1.
- Карта — 6/6, расчёт — 4/4, пользовательский маршрут — 11/11, симуляция — 38/38. Всего перечислено 99 успешных тестов; полный набор всех существующих браузерных регрессий не запускался.
- Оба Docker-образа собраны из чистого экспорта с закреплённым lockfile.
- HTTP-проверка финального web-образа: главная, `/start`, `/map`, каталог, модель, кейсы, симуляция, глоссарий, новости, кабинеты, заявки, обе карты сайта, CSS бренда и hero-видео — HTTP 200 с ожидаемым типом содержимого. Внутренние страницы отдают свои SEO-оболочки.
- Без авторизации кабинеты/API заявок возвращают 401; модерация новостей без настроенного токена — 503. Рабочие секреты при проверке не использовались.

**Ограничение среды проверки:** стандартный `docker compose up --build --wait` здесь не завершился успешно: Docker runtime отклонил healthcheck-процесс news с `OCI runtime exec failed ... setns`, а обмен между контейнерами по bridge зависал. Сервер новостей при этом отвечал на `/healthz` и `/news` с хоста. Для HTTP-проверки использован тот же финальный web-образ с диагностической сетью host и временной заменой адреса upstream; конфигурация Compose в поставке оставлена стандартной. Успешный healthcheck обоих сервисов в обычной сети Compose **не подтверждён** этим запуском.

**GitHub Actions:** подключение не разрешило обновить `.github/workflows/verify.yml`; существующий удалённый файл сохранён. Новая конфигурация и инструкция владельцу: [GITHUB_ACTIONS.md](GITHUB_ACTIONS.md). Локальный результат не объявляется результатом CI.