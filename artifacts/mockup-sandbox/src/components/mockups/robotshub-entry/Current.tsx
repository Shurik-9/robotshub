import { useState } from 'react';
import { ArrowRight, BookOpenCheck, CircleHelp } from 'lucide-react';
import './_group.css';
import './_source-start.css';

// Exact introduction extracted from the current /start, without its router,
// project store or calculation side effects. Full source is kept alongside it.
export function Current() {
  const [notice, setNotice] = useState(false);
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="start-page mx-auto w-full max-w-6xl px-4 pb-16 pt-7 sm:px-6 sm:pt-10">
        <section className="start-intro" aria-labelledby="start-page-title">
          <div className="start-intro-copy">
            <p className="start-eyebrow"><span className="start-led" /> ПЕРВИЧНАЯ ОЦЕНКА / ROBOTSHUB</p>
            <h1 id="start-page-title">Сначала задача.<br /><em>Потом расчёт.</em></h1>
            <p className="start-lede">Проверьте, какие данные уже есть, где модель использует допущения и что стоит подтвердить на площадке — прежде чем сравнивать оборудование.</p>
            <div className="start-intro-links">
              <button type="button" onClick={() => setNotice(value => !value)} className="start-article-link">
                <BookOpenCheck aria-hidden="true" size={18} />
                Как устроен складской поток
                <ArrowRight aria-hidden="true" size={16} />
              </button>
              <span className="start-time-note">Быстрый просмотр не заменяет сохранённый проект</span>
            </div>
          </div>
          <aside className="start-intro-aside" aria-label="Границы первичной оценки">
            <div className="start-note-heading"><CircleHelp size={17} aria-hidden="true" /> ЧТО МОЖНО УЗНАТЬ СЕЙЧАС</div>
            <p><strong>Складская логистика</strong> — ориентир по парку и экономике на базе модели и карточки решения в каталоге.</p>
            <p><strong>Другие направления</strong> — доступные решения и примеры из базы, без универсального прогноза окупаемости.</p>
            <div className="start-note-foot">Результат — отправная точка для проверки, не проектное заключение и не смета поставщика.</div>
          </aside>
          <div className="start-flow" aria-label="Что происходит в оценке">
            <div><span>ОБЪЕКТ</span><strong>Вы задаёте контекст</strong></div>
            <i aria-hidden="true" />
            <div><span>МОДЕЛЬ</span><strong>Допущения видны отдельно</strong></div>
            <i aria-hidden="true" />
            <div><span>СЛЕДУЮЩИЙ ШАГ</span><strong>Уточнение или каталог</strong></div>
          </div>
        </section>
        {notice && <p className="mt-6 rounded-lg border border-border p-4">Это исходное вступление для сравнения. Варианты А и Б открываются в отдельных прототипах; рабочий сайт и проект не изменяются.</p>}
        <section className="start-workspace" aria-labelledby="start-industry-title">
          <div className="start-section-heading">
            <div><p className="start-kicker">ВЫБЕРИТЕ НАПРАВЛЕНИЕ</p>
              <h2 id="start-industry-title">Где находится ваша задача?</h2>
              <p>Можно начать с типа площадки или сразу выбрать отрасль. Отрасль, физический объект и операция — разные признаки.</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
