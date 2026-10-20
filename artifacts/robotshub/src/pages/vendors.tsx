import { useEffect, useState, type FormEvent } from 'react';
import { ArrowUpRight, Check, ChevronDown, CircleCheck, Mail, ShieldCheck } from 'lucide-react';

type VendorRequest = {
  name: string;
  company: string;
  models: string;
  phone: string;
  submittedAt: string;
};

type FormValues = Omit<VendorRequest, 'submittedAt'>;

const FAQ = [
  {
    question: 'Откуда у вас клиенты?',
    answer:
      'Органика по запросам «роботизация склада», «амр цена», «окупаемость робота» и материалы: карта 45 внедрений, статьи, расчётчик. Статистику просмотров вашей карточки показываем в кабинете до оплаты.',
  },
  {
    question: 'Что если лидов будет меньше пакета?',
    answer:
      'Нецелевые заменяем, недостающие по пакету переносим на следующий месяц. Если качество системно не устраивает — расстаёмся до оплаты следующего периода.',
  },
  {
    question: 'Кто ещё увидит контакт клиента?',
    answer:
      'Никто. До нажатия «Передать вендору» контакты не видны даже нам в интерфейсе вендора; после передачи — только вашей организации.',
  },
  {
    question: 'Можно эксклюзив на нишу?',
    answer:
      'Возможно, за отдельную плату и после пилота. Порядок органической выдачи не продаётся в любом случае.',
  },
  {
    question: 'Как проверять качество до оплаты?',
    answer: 'Пилот: 2 лида бесплатно + статистика просмотров карточки. Потом решаете.',
  },
  {
    question: 'Как подключиться?',
    answer: 'Проверяем карточку (фото, ТТХ, цены), закрепляем за вами, включаем приём заявок — 2 дня.',
  },
];

const STEPS = [
  {
    title: 'Считают вашу модель',
    text: 'публичный расчёт экономики и симуляция флота: клиент проверяет вашу технику на своём объекте до звонка вам.',
  },
  {
    title: 'Оставляют заявку',
    text: 'площадь, задача, сменность и посчитанная окупаемость прилагаются к контакту.',
  },
  {
    title: 'Проверяем и передаём',
    text: 'заявку проверяет человек. Контакты клиента уходят только вам и никому больше: они не видны другим вендорам.',
  },
  {
    title: 'Работаете в кабинете',
    text: 'лиды в кабинете партнёра, выгрузка в CSV, статистика просмотров вашей карточки.',
  },
];

const STORAGE_KEY = 'robotshub-vendor-requests';
const DRAFT_KEY = 'robotshub-vendor-form-draft';
const EMPTY_FORM: FormValues = { name: '', company: '', models: '', phone: '' };

function readDraft(): FormValues {
  try {
    const value = localStorage.getItem(DRAFT_KEY);
    if (!value) return EMPTY_FORM;
    const parsed = JSON.parse(value) as Partial<FormValues>;
    return {
      name: typeof parsed.name === 'string' ? parsed.name : '',
      company: typeof parsed.company === 'string' ? parsed.company : '',
      models: typeof parsed.models === 'string' ? parsed.models : '',
      phone: typeof parsed.phone === 'string' ? parsed.phone : '',
    };
  } catch {
    return EMPTY_FORM;
  }
}

function validModelLinks(value: string) {
  const links = value.split(/[\n,;]+/).map(link => link.trim()).filter(Boolean);
  if (!links.length) return false;
  return links.every(link => {
    try {
      const url = new URL(link);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  });
}

export default function Vendors() {
  const [form, setForm] = useState<FormValues>(readDraft);
  const [errors, setErrors] = useState<Partial<Record<keyof FormValues, string>>>({});
  const [accepted, setAccepted] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  useEffect(() => {
    document.title = 'Robotshub — заявки на вашу робототехнику от клиентов, которые уже посчитали экономику';
    let description = document.querySelector('meta[name="description"]');
    if (!description) {
      description = document.createElement('meta');
      description.setAttribute('name', 'description');
      document.head.appendChild(description);
    }
    description.setAttribute(
      'content',
      'Клиент подбирает робота на своём объекте и просит КП именно вашей модели. Объект, задача, расчёт — в каждой заявке. Пилот — 2 лида бесплатно.',
    );
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(form));
    } catch {
      setStorageError(true);
    }
  }, [form]);

  const updateField = (field: keyof FormValues, value: string) => {
    setForm(current => ({ ...current, [field]: value }));
    setErrors(current => ({ ...current, [field]: undefined }));
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors: Partial<Record<keyof FormValues, string>> = {};
    if (!form.name.trim()) nextErrors.name = 'Укажите имя.';
    if (!form.company.trim()) nextErrors.company = 'Укажите компанию.';
    if (!validModelLinks(form.models)) nextErrors.models = 'Добавьте одну или несколько корректных ссылок на модели (http:// или https://).';
    const digits = form.phone.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 15) nextErrors.phone = 'Укажите корректный номер телефона.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    try {
      const previous = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as VendorRequest[];
      const request: VendorRequest = { ...form, submittedAt: new Date().toISOString() };
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...previous, request]));
      localStorage.removeItem(DRAFT_KEY);
      setAccepted(true);
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  };

  return (
    <main className="min-h-[100dvh] flex-1 overflow-hidden bg-[#0A101D] text-slate-100">
      <section className="relative isolate overflow-hidden border-b border-[#22304A]">
        <div aria-hidden="true" className="pointer-events-none absolute -right-32 -top-40 -z-10 h-[34rem] w-[34rem] rounded-full border border-[#29405A] opacity-40" />
        <div aria-hidden="true" className="pointer-events-none absolute -right-12 -top-20 -z-10 h-[24rem] w-[24rem] rounded-full border border-[#29405A] opacity-50" />
        <div className="mx-auto grid max-w-7xl gap-12 px-5 pb-16 pt-14 sm:px-8 sm:pb-24 sm:pt-20 lg:grid-cols-[1.15fr_.85fr] lg:items-center lg:px-12 lg:py-28">
          <div className="max-w-3xl">
            <p className="mb-6 flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.2em] text-[#22D3EE]">
              <span className="h-px w-8 bg-[#22D3EE]" />
              Партнёрская программа Robotshub
            </p>
            <h1 className="max-w-4xl text-4xl font-bold leading-[1.06] tracking-[-0.04em] text-white sm:text-5xl lg:text-6xl">
              «Заявки на ваши роботы уже собираются здесь»
            </h1>
            <p className="mt-7 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
              «224 решения в каталоге с реальными ценами. Клиент считает экономику на цифрах вашей модели — и оставляет заявку "Запросить КП". В заявке: объект, задача и посчитанная окупаемость вашей техники».
            </p>
            <div className="mt-9 flex flex-col gap-4 sm:flex-row sm:items-center">
              <a
                href="mailto:sales@robotshub.ru"
                data-testid="link-vendor-pilot-cta"
                className="inline-flex min-h-14 items-center justify-center gap-3 rounded-lg bg-[#22D3EE] px-6 py-4 text-center text-sm font-bold leading-5 text-[#0A101D] transition-transform hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#22D3EE]"
              >
                Закрепить карточку и получить 2 лида бесплатно
                <ArrowUpRight className="h-4 w-4 shrink-0" aria-hidden="true" />
              </a>
              <span className="text-sm text-slate-400">Пилот без оплаты. Без обязательств.</span>
            </div>
          </div>
          <div className="relative mx-auto w-full max-w-md">
            <div className="rounded-2xl border border-[#2C405A] bg-[#111B2B] p-5 shadow-[0_30px_80px_rgba(0,0,0,.25)] sm:p-7">
              <div className="flex items-start justify-between border-b border-[#263750] pb-5">
                <div>
                  <span className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Заявка от клиента</span>
                  <p className="mt-2 text-lg font-semibold text-white">Запросить КП</p>
                </div>
                <span className="rounded-full border border-[#22D3EE]/30 bg-[#22D3EE]/10 px-3 py-1 text-xs font-semibold text-[#22D3EE]">проверена</span>
              </div>
              <div className="space-y-4 py-5 text-sm">
                <div className="flex justify-between gap-4"><span className="text-slate-400">Объект</span><span className="text-right text-slate-100">РЦ 5 000 м²</span></div>
                <div className="flex justify-between gap-4"><span className="text-slate-400">Задача</span><span className="text-right text-slate-100">40 палет / смену</span></div>
                <div className="flex justify-between gap-4"><span className="text-slate-400">Модель</span><span className="text-right text-slate-100">H1500</span></div>
                <div className="flex justify-between gap-4 border-t border-[#263750] pt-4"><span className="text-slate-400">Окупаемость</span><span className="font-mono font-semibold text-[#22D3EE]">0,9 года</span></div>
              </div>
              <div className="flex items-center gap-3 rounded-lg bg-[#0A101D] px-4 py-3 text-xs leading-5 text-slate-400">
                <ShieldCheck className="h-5 w-5 shrink-0 text-[#22D3EE]" aria-hidden="true" />
                Контакты клиента передаются только выбранному вендору
              </div>
            </div>
            <div aria-hidden="true" className="absolute -bottom-5 -left-5 -z-10 h-24 w-24 rounded-full bg-[#22D3EE]/10 blur-2xl" />
          </div>
        </div>
      </section>

      <section aria-label="Ключевые показатели" className="border-b border-[#22304A] bg-[#0D1726]">
        <div className="mx-auto grid max-w-7xl grid-cols-2 divide-[#263750] px-5 py-7 sm:px-8 md:grid-cols-4 lg:px-12">
          {[
            ['224', 'решения'],
            ['45', 'разобранных внедрений'],
            ['расчёт', 'за 1 минуту'],
            ['12', 'направлений роботизации'],
          ].map(([value, label]) => (
            <div key={value} className="border-b border-[#263750] py-4 first:pl-0 odd:pr-4 even:pl-5 sm:px-6 md:border-b-0 md:border-l md:first:border-l-0 md:py-2">
              <p className="font-mono text-2xl font-semibold tracking-tight text-white sm:text-3xl">{value}</p>
              <p className="mt-1 text-xs leading-5 text-slate-400 sm:text-sm">{label}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-24 lg:px-12">
        <div className="mb-12 grid gap-5 md:grid-cols-[.8fr_1.2fr] md:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#22D3EE]">От расчёта до сделки</p>
            <h2 className="mt-4 text-3xl font-bold tracking-[-0.035em] text-white sm:text-4xl">Как это работает — 4 шага</h2>
          </div>
          <p className="max-w-xl text-sm leading-7 text-slate-400">Клиент приходит подготовленным: уже проверил решение на своём объекте и понимает экономику.</p>
        </div>
        <div className="grid gap-0 border-y border-[#263750] md:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, index) => (
            <article key={step.title} className="relative border-b border-[#263750] py-7 md:px-6 md:first:pl-0 lg:border-b-0 lg:border-l lg:first:border-l-0 lg:py-8">
              <span className="font-mono text-sm text-[#22D3EE]">0{index + 1}</span>
              <h3 className="mt-5 text-lg font-semibold text-white">{step.title}</h3>
              <p className="mt-3 text-sm leading-6 text-slate-400">{step.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="border-y border-[#22304A] bg-[#101A29]">
        <div className="mx-auto grid max-w-7xl gap-12 px-5 py-20 sm:px-8 sm:py-24 lg:grid-cols-[.78fr_1.22fr] lg:px-12">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#22D3EE]">Контекст вместо клика</p>
            <h2 className="mt-4 text-3xl font-bold leading-tight tracking-[-0.035em] text-white sm:text-4xl">Чем наш лид отличается от заявки с рекламы</h2>
            <p className="mt-5 max-w-md text-sm leading-7 text-slate-400">Вендор получает запрос на конкретную модель и вводные, с которыми можно сразу готовить предметное КП.</p>
          </div>
          <div className="space-y-0">
            <article className="border-t border-[#304159] py-6 sm:grid sm:grid-cols-[2.5rem_1fr] sm:gap-5">
              <span className="font-mono text-xs text-[#22D3EE]">01</span>
              <p className="mt-2 text-sm leading-7 text-slate-300 sm:mt-0">Цена лида с рекламы промышленного оборудования — 8–20 тыс. ₽, квалифицированного — в 3–5 раз дороже. Наш лид стоит от 13–15 тыс. ₽ и приходит с объектом и расчётом.</p>
            </article>
            <article className="border-t border-[#304159] py-6 sm:grid sm:grid-cols-[2.5rem_1fr] sm:gap-5">
              <span className="font-mono text-xs text-[#22D3EE]">02</span>
              <p className="mt-2 text-sm leading-7 text-slate-300 sm:mt-0">Обычная заявка: «есть ли у вас что-то для склада?». Наша: «РЦ 5 000 м², палетоупаковка 40 палет/смену, окупаемость H1500 — 0,9 года, пришлите КП».</p>
            </article>
            <article className="border-y border-[#304159] py-6 sm:grid sm:grid-cols-[2.5rem_1fr] sm:gap-5">
              <span className="font-mono text-xs text-[#22D3EE]">03</span>
              <p className="mt-2 text-sm leading-7 text-slate-300 sm:mt-0">Заявка идёт в одну карточку: клиент выбрал вашу модель, а не собрал прайс у всех подряд.</p>
            </article>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-24 lg:px-12">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#22D3EE]">Понятная экономика</p>
          <h2 className="mt-4 text-3xl font-bold tracking-[-0.035em] text-white sm:text-4xl">Тарифы</h2>
        </div>
        <div className="mt-10 overflow-hidden rounded-xl border border-[#2B3D55]">
          <div className="grid grid-cols-3 bg-[#121E2F]">
            {[
              { name: 'Старт', price: '75 000 ₽/мес', detail: '5 лидов · 15 000 ₽/лид' },
              { name: 'Рост', price: '180 000 ₽/мес', detail: '12 лидов · 15 000 ₽/лид' },
              { name: 'Партнёр', price: '390 000 ₽/мес', detail: '30 лидов · 13 000 ₽/лид', featured: true },
            ].map(tier => (
              <div key={tier.name} className={`relative min-w-0 border-r border-[#2B3D55] p-4 last:border-r-0 sm:p-7 ${tier.featured ? 'bg-[#17283A]' : ''}`}>
                {tier.featured && <span className="absolute right-2 top-2 hidden rounded-full bg-[#22D3EE]/10 px-2 py-1 text-[10px] font-semibold text-[#22D3EE] sm:block">Максимум лидов</span>}
                <p className="text-sm font-semibold text-slate-300 sm:text-base">{tier.name}</p>
                <p className="mt-5 text-lg font-bold tracking-tight text-white sm:text-2xl">{tier.price}</p>
                <p className="mt-3 text-xs leading-5 text-slate-400 sm:text-sm">{tier.detail}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-5 flex gap-4 rounded-xl border border-[#22D3EE]/25 bg-[#22D3EE]/[0.06] p-5 sm:items-center sm:px-7 sm:py-6">
          <CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#22D3EE]" aria-hidden="true" />
          <p className="text-sm leading-6 text-slate-200">Пилот — 2 бесплатных лида. Платите после того, как сравнили качество с текущим каналом. Нецелевой лид заменяем бесплатно.</p>
        </div>
      </section>

      <section className="border-y border-[#22304A] bg-[#101A29]">
        <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-24 lg:px-12">
          <div className="grid gap-10 md:grid-cols-[.8fr_1.2fr]">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#22D3EE]">Прозрачные условия</p>
              <h2 className="mt-4 text-3xl font-bold tracking-[-0.035em] text-white sm:text-4xl">Правила площадки</h2>
            </div>
            <ul className="divide-y divide-[#2B3D55] border-y border-[#2B3D55]">
              {[
                'Позиция в каталоге не продаётся: органическая выдача одинакова для всех. Покупается поток заявок, не место.',
                'Карточка защищена: название, производитель и категория не правятся никем; ваши правки — через модерацию, с историей.',
                'Мы не внедряем и не продаём технику сами — нейтральная площадка подбора.',
                'Мы не обещаем «гарантированных сделок»: гарантируем квалификацию лида. Сделку заключаете вы.',
              ].map(rule => (
                <li key={rule} className="flex gap-4 py-5 text-sm leading-6 text-slate-300">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#22D3EE]" aria-hidden="true" />
                  <span>{rule}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-5 py-20 sm:px-8 sm:py-24 lg:px-12">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#22D3EE]">Вопросы и ответы</p>
          <h2 className="mt-4 text-3xl font-bold tracking-[-0.035em] text-white sm:text-4xl">FAQ</h2>
        </div>
        <div className="mt-10 border-t border-[#2B3D55]">
          {FAQ.map((item, index) => {
            const isOpen = openFaq === index;
            const answerId = `vendor-faq-answer-${index}`;
            return (
              <article key={item.question} className="border-b border-[#2B3D55]">
                <h3>
                  <button
                    type="button"
                    id={`vendor-faq-question-${index}`}
                    aria-expanded={isOpen}
                    aria-controls={answerId}
                    data-testid={`button-vendor-faq-${index + 1}`}
                    onClick={() => setOpenFaq(isOpen ? null : index)}
                    className="flex w-full items-center justify-between gap-6 py-5 text-left text-base font-semibold text-slate-100 transition-colors hover:text-[#22D3EE] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#22D3EE] sm:py-6"
                  >
                    {item.question}
                    <ChevronDown className={`h-5 w-5 shrink-0 text-[#22D3EE] transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
                  </button>
                </h3>
                <div id={answerId} role="region" aria-labelledby={`vendor-faq-question-${index}`} hidden={!isOpen} className="pb-6 pr-10 text-sm leading-7 text-slate-400">
                  {item.answer}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="border-t border-[#263750] bg-[#0D1726]">
        <div className="mx-auto max-w-7xl px-5 py-16 sm:px-8 sm:py-20 lg:px-12">
          <div className="grid gap-12 lg:grid-cols-[.9fr_1.1fr] lg:gap-20">
            <div className="flex flex-col items-start">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#22D3EE]">Начните с пилота</p>
              <h2 className="mt-4 text-3xl font-bold leading-tight tracking-[-0.035em] text-white sm:text-4xl">«Ваши конкуренты в каталоге уже отвечают на эти заявки. Закрепите карточку — пилот ничего не стоит».</h2>
              <a href="mailto:sales@robotshub.ru" data-testid="link-vendor-email" className="mt-7 inline-flex items-center gap-3 text-sm font-semibold text-[#22D3EE] underline decoration-[#22D3EE]/40 underline-offset-4 transition-colors hover:text-white hover:decoration-white">
                <Mail className="h-4 w-4" aria-hidden="true" />
                sales@robotshub.ru
                <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
              </a>
              <p className="mt-6 max-w-sm text-sm leading-6 text-slate-400">Оставьте контакты и ссылки на модели — команда проверит карточку и вернётся к вам.</p>
            </div>

            <div className="rounded-2xl border border-[#2B3D55] bg-[#111B2B] p-5 sm:p-8">
              {accepted ? (
                <div role="status" aria-live="polite" data-testid="status-vendor-request-accepted" className="flex min-h-[22rem] flex-col items-center justify-center text-center">
                  <span className="flex h-14 w-14 items-center justify-center rounded-full border border-[#22D3EE]/30 bg-[#22D3EE]/10 text-[#22D3EE]">
                    <Check className="h-7 w-7" aria-hidden="true" />
                  </span>
                  <h3 className="mt-6 text-2xl font-bold text-white">Заявка принята — свяжемся в течение рабочего дня</h3>
                  <p className="mt-3 max-w-sm text-sm leading-6 text-slate-400">Данные сохранены в этом браузере.</p>
                </div>
              ) : (
                <>
                  <h3 className="text-xl font-semibold text-white">Обсудить подключение</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-400">Расскажите о компании и моделях, которые хотите разместить.</p>
                  <form onSubmit={submit} noValidate className="mt-7 space-y-5">
                    <div className="grid gap-5 sm:grid-cols-2">
                      <div>
                        <label htmlFor="vendor-name" className="mb-2 block text-sm font-medium text-slate-200">Имя</label>
                        <input id="vendor-name" name="name" autoComplete="name" value={form.name} onChange={event => updateField('name', event.target.value)} aria-invalid={!!errors.name} aria-describedby={errors.name ? 'vendor-name-error' : undefined} data-testid="input-vendor-name" className="h-12 w-full rounded-lg border border-[#35465D] bg-[#0A101D] px-4 text-sm text-white outline-none transition-colors placeholder:text-slate-600 focus:border-[#22D3EE] focus:ring-2 focus:ring-[#22D3EE]/15" placeholder="Как к вам обращаться" />
                        {errors.name && <p id="vendor-name-error" className="mt-2 text-xs text-rose-300">{errors.name}</p>}
                      </div>
                      <div>
                        <label htmlFor="vendor-company" className="mb-2 block text-sm font-medium text-slate-200">Компания</label>
                        <input id="vendor-company" name="company" autoComplete="organization" value={form.company} onChange={event => updateField('company', event.target.value)} aria-invalid={!!errors.company} aria-describedby={errors.company ? 'vendor-company-error' : undefined} data-testid="input-vendor-company" className="h-12 w-full rounded-lg border border-[#35465D] bg-[#0A101D] px-4 text-sm text-white outline-none transition-colors placeholder:text-slate-600 focus:border-[#22D3EE] focus:ring-2 focus:ring-[#22D3EE]/15" placeholder="Название компании" />
                        {errors.company && <p id="vendor-company-error" className="mt-2 text-xs text-rose-300">{errors.company}</p>}
                      </div>
                    </div>
                    <div>
                      <label htmlFor="vendor-model-links" className="mb-2 block text-sm font-medium text-slate-200">Ссылки на модели</label>
                      <textarea id="vendor-model-links" name="models" value={form.models} onChange={event => updateField('models', event.target.value)} aria-invalid={!!errors.models} aria-describedby={errors.models ? 'vendor-models-error' : 'vendor-models-hint'} data-testid="input-vendor-model-links" rows={3} className="w-full resize-y rounded-lg border border-[#35465D] bg-[#0A101D] px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-slate-600 focus:border-[#22D3EE] focus:ring-2 focus:ring-[#22D3EE]/15" placeholder="https://… (по одной ссылке на строку)" />
                      <p id="vendor-models-hint" className="mt-2 text-xs leading-5 text-slate-500">Вставьте ссылки на страницы моделей, по одной на строку.</p>
                      {errors.models && <p id="vendor-models-error" className="mt-2 text-xs text-rose-300">{errors.models}</p>}
                    </div>
                    <div>
                      <label htmlFor="vendor-phone" className="mb-2 block text-sm font-medium text-slate-200">Телефон</label>
                      <input id="vendor-phone" name="phone" type="tel" autoComplete="tel" value={form.phone} onChange={event => updateField('phone', event.target.value)} aria-invalid={!!errors.phone} aria-describedby={errors.phone ? 'vendor-phone-error' : undefined} data-testid="input-vendor-phone" className="h-12 w-full rounded-lg border border-[#35465D] bg-[#0A101D] px-4 text-sm text-white outline-none transition-colors placeholder:text-slate-600 focus:border-[#22D3EE] focus:ring-2 focus:ring-[#22D3EE]/15" placeholder="+7 (___) ___-__-__" />
                      {errors.phone && <p id="vendor-phone-error" className="mt-2 text-xs text-rose-300">{errors.phone}</p>}
                    </div>
                    {storageError && <p role="alert" data-testid="status-vendor-storage-error" className="rounded-lg border border-rose-400/30 bg-rose-400/5 px-4 py-3 text-sm leading-6 text-rose-200">Не удалось сохранить данные в этом браузере. Проверьте настройки хранилища и попробуйте ещё раз.</p>}
                    <button type="submit" data-testid="button-submit-vendor-request" className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-[#22D3EE] px-5 py-3 text-sm font-bold text-[#0A101D] transition-transform hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#22D3EE]">
                      Отправить заявку
                      <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <p className="text-xs leading-5 text-slate-500">Заявка сохраняется локально в браузере и доступна для выгрузки администратором.</p>
                  </form>
                </>
              )}
            </div>
          </div>
        </div>
      </section>
      <a href="#top" onClick={event => { event.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }} data-testid="link-vendor-back-to-top" className="sr-only focus:not-sr-only focus:fixed focus:bottom-4 focus:right-4 focus:z-50 focus:flex focus:items-center focus:gap-2 focus:rounded-lg focus:bg-[#22D3EE] focus:px-4 focus:py-3 focus:font-semibold focus:text-[#0A101D]">
        <ArrowUpRight className="h-4 w-4 rotate-[-45deg]" aria-hidden="true" />
        Наверх
      </a>
    </main>
  );
}
