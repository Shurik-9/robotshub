import './_group.css';
import {
  IconCalculator,
  IconChartRoi,
  IconClockPayback,
} from './brand-icons';

const TRACKS = [
  {
    title: 'Решаю задачу',
    who: 'Для директора, владельца, начальника склада',
    text: 'Быстрая предварительная оценка парка и экономики по выбранной площадке.',
    meta: 'короткий маршрут',
    href: '/start',
    icon: IconClockPayback,
  },
  {
    title: 'Считаю экономику',
    who: 'Для экономиста, снабженца, ПТО',
    text: 'Сравнение покупки, лизинга и RaaS, анализ чувствительности и отчёт.',
    meta: 'расчёт и допущения',
    href: '/calc',
    icon: IconCalculator,
  },
  {
    title: 'Выбираю технику',
    who: 'Для инженера, технолога, интегратора',
    text: 'Каталог решений, технические данные и подтверждённый опыт применения.',
    meta: 'каталог, карта, кейсы',
    href: '/solutions',
    icon: IconChartRoi,
  },
];

const INDUSTRIES = [
  'Торговля и услуги',
  'Промышленность',
  'Транспорт и логистика',
  'ТЭК',
  'Сельское хозяйство',
  'Безопасность',
  'Строительство',
  'ЖКХ',
  'Лесное хозяйство',
];

function Header() {
  return (
    <header className="flex h-16 items-center justify-between border-b border-[#1e293b] px-4">
      <img src="/__mockup/images/robotshub-logo.jpg" alt="RobotsHub" className="h-10 w-10 rounded-md object-cover" />
      <nav className="flex items-center gap-3 text-sm text-[#9ba9bb]">
        <a href="/map">Карта</a>
        <a href="/solutions">Каталог</a>
        <a href="/start" className="rounded-md bg-[#22d3ee] px-4 py-2 font-semibold text-[#0b1220]">Посчитать за 3 минуты</a>
      </nav>
    </header>
  );
}

export function Current() {
  const total = 223;

  return (
    <div className="min-h-screen bg-[#0b1220]" data-testid="page-home-current">
      <Header />
      <main className="mx-auto w-full max-w-5xl px-4 pb-16 pt-10 sm:pt-14">
        <section className="text-center">
          <h1 className="mx-auto max-w-3xl text-3xl font-bold leading-tight tracking-tight text-[#e7edf6] sm:text-4xl">
            Узнайте, сколько роботов нужно вашей площадке — и сколько это будет стоить
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base text-[#9ba9bb] sm:text-lg">
            Подбор решений и предварительная оценка экономики. Начните с демонстрационного примера или задайте параметры своего объекта.
          </p>
          <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a href="/start" className="inline-flex h-12 items-center justify-center rounded-md bg-[#22d3ee] px-7 text-base font-semibold text-[#0b1220]">
              Посчитать за 3 минуты
            </a>
            <a href="/simulation" className="inline-flex h-12 items-center justify-center rounded-md border border-[#273449] px-6 text-base font-medium text-[#e7edf6]">
              Посмотреть демонстрацию
            </a>
          </div>
        </section>

        <section className="mt-14 grid gap-4 md:grid-cols-3" aria-label="Выберите задачу">
          {TRACKS.map(track => (
            <a key={track.title} href={track.href} className="group flex flex-col rounded-2xl border border-[rgba(148,163,184,0.16)] bg-[#101724] p-6">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#06202A] text-[#22D3EE]">
                <track.icon className="h-5 w-5" aria-hidden="true" />
              </div>
              <h2 className="mt-4 text-xl font-semibold text-[#e7edf6]">{track.title}</h2>
              <p className="mt-1 text-sm font-medium text-[#8FA3BB]">{track.who}</p>
              <p className="mt-3 flex-1 text-sm leading-relaxed text-[#a5b1c2]">{track.text}</p>
              <p className="mt-4 border-t border-[rgba(148,163,184,0.16)] pt-3 text-xs font-medium uppercase tracking-wider text-[#22D3EE]">{track.meta}</p>
            </a>
          ))}
        </section>

        <section className="mt-14" aria-labelledby="home-industries-heading">
          <h2 id="home-industries-heading" className="text-center text-lg font-semibold text-[#e7edf6]">
            Роботы уже работают в 9 отраслях
          </h2>
          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {INDUSTRIES.map(industry => (
              <a key={industry} href={`/start?industry=${encodeURIComponent(industry)}`} className="rounded-lg border border-[rgba(148,163,184,0.16)] bg-[#101724] px-4 py-3 text-center text-sm font-medium text-[#e7edf6]">
                {industry}
              </a>
            ))}
          </div>
          <p className="mt-5 text-center">
            <a href="/map" className="text-sm font-medium text-[#22D3EE]">Открыть полную карту роботизации →</a>
          </p>
        </section>

        <section className="mt-12 border-t border-[rgba(148,163,184,0.16)] pt-6 text-center text-sm text-[#9ba9bb]">
          {total} записи в базе · 9 отраслей · внедрения, пилоты и разработки по открытым источникам
        </section>
      </main>
    </div>
  );
}
