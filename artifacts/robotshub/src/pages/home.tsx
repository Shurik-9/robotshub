import './home-operations.css';
import { useState } from 'react';
import { Link } from 'wouter';
import {
  IconCalculator,
  IconWarehouse,
  IconRobotAmr,
  IconOperations,
  IconInfoAssumption,
} from '@/components/brand-icons';
import { useSectorMap } from '@/lib/useSectorMap';

const PARTNERS = [
  'Алабуга', 'Билайн', 'ВК тех', 'ГКМ', 'ГОЧС', 'ГПБ', 'Геоскан',
  'ДЖКХ', 'ДИТ', 'ДПИиР', 'ДФ', 'КМ Стройнадзор', 'КМ Экология',
  'ММ', 'МТ', 'ПТ', 'РСХБ', 'Ростелеком', 'ФЦ БАС', 'Фалькон', 'ЦДиТМ', 'ЯК',
];
const TRACKS = [
  {
    n: '01', title: 'Начать с площадки', who: 'Если задача ещё не сформулирована',
    text: 'Весь объект, несколько участков или один процесс — выберите свой масштаб.',
    href: '/start', icon: IconWarehouse, tag: 'ПЛОЩАДКА → КАРТА', testid: 'card-track-task',
  },
  {
    n: '02', title: 'Изучить карту применений', who: 'Если хотите сначала увидеть отраслевые примеры',
    text: 'Смотрите, где упоминают роботизацию и что именно подтверждают источники.',
    href: '/map', icon: IconOperations, tag: 'ОТРАСЛЬ → ПРИМЕРЫ', testid: 'card-track-map',
  },
  {
    n: '03', title: 'Проверить экономику решения', who: 'Если уже выбрали конкретную модель',
    text: 'Посмотрите, какие исходные данные и допущения влияют на расчёт.',
    href: '/calc', icon: IconCalculator, tag: 'МОДЕЛЬ → ДОПУЩЕНИЯ', testid: 'card-track-econ',
  },
];

function Mark({ n }: { n: string }) {
  return <span className="ops-mark" aria-hidden="true">{n}</span>;
}

function HeroVideo() {
  return (
    <div className="ops-diagram ops-video-shell" data-testid="hero-video-frame">
      <video
        className="ops-hero-video"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        disablePictureInPicture
        disableRemotePlayback
        poster={`${import.meta.env.BASE_URL}media/home-hero-loop-poster.webp`}
        aria-hidden="true"
        data-testid="hero-video"
      >
        <source src={`${import.meta.env.BASE_URL}media/home-hero-loop.mp4`} type="video/mp4" />
      </video>
    </div>
  );
}

function PartnerStrip() {
  const [paused, setPaused] = useState(false);
  const group = (copy: boolean) => (
    <div className="ops-partner-group" aria-hidden={copy || undefined}>
      {PARTNERS.map((name, index) => (
        <div className="ops-partner-logo" key={`${copy ? 'copy-' : ''}${name}`} title={copy ? undefined : name}>
          <img src={`${import.meta.env.BASE_URL}brand/partners/${String(index + 1).padStart(2, '0')}.webp`} alt={copy ? '' : name} />
        </div>
      ))}
    </div>
  );
  return (
    <section className="ops-partners" aria-label="Логотипы организаций из исходной подборки">
      <div className="ops-partners-head">
        <button className="ops-pause" type="button" aria-pressed={paused}
          aria-label={paused ? 'Продолжить движение логотипов' : 'Приостановить движение логотипов'}
          onClick={() => setPaused(value => !value)} data-testid="button-pause-partners">
          <span aria-hidden="true">{paused ? '▶' : 'Ⅱ'}</span>{paused ? 'Продолжить' : 'Пауза'}
        </button>
      </div>
      <div className={`ops-partners-window${paused ? ' is-paused' : ''}`}>
        <div className="ops-partners-track">{group(false)}{group(true)}</div>
      </div>
    </section>
  );
}

export default function Home() {
  const { sectors, error } = useSectorMap();
  const industries = (sectors ?? []).filter(sector => !sector.thematic);
  const totalRecords = industries.reduce((sum, sector) => sum + sector.n, 0);

  return (
    <div className="ops-home" data-testid="page-home">
      <main>
        <section className="ops-hero">
          <div className="ops-hero-copy">
            <div className="ops-eyebrow"><span className="ops-led" /> ИНЖЕНЕРНОЕ РЕШЕНИЕ ДЛЯ ПРИНЯТИЯ РЕШЕНИЙ <span className="ops-divider">/</span> РФ</div>
            <h1>Сначала<br /><em>площадка.</em><br />Потом решение.</h1>
            <p className="ops-hero-lede">Выберите охват задачи: весь объект, несколько участков или один процесс. Подбор и расчёт — следующим шагом.</p>
            <div className="ops-hero-actions">
              <Link href="/start" className="ops-button-primary" data-testid="cta-start">Описать объект <span aria-hidden="true">↗</span></Link>
              <Link href="/solutions" className="ops-button-quiet" data-testid="cta-catalog">Уже выбираете модель? Каталог <span aria-hidden="true">→</span></Link>
            </div>
            <div className="ops-hero-note" data-testid="home-no-area-estimate"><IconInfoAssumption size={16} /><span>Парк роботов не выводим из одной площади.</span></div>
          </div>
          <div className="ops-hero-art">
            <HeroVideo />
          </div>
        </section>

        <section className="ops-data-rail" aria-label="Состав базы Железный аргумент">
          <div className="ops-data-intro"><span className="ops-kicker">ДАННЫЕ КАТАЛОГА</span><p>Материалы для первичной проверки.</p></div>
              <div className="ops-data-item"><strong>{sectors ? totalRecords : '…'}</strong><span>записей базы</span></div>
              <div className="ops-data-item"><strong>{sectors ? industries.length : '…'}</strong><span>базовых отраслей</span></div>
              <div className="ops-data-foot" role={error ? 'status' : undefined}>
                {error ? 'Не удалось загрузить данные карты.' : 'Количество записей — не число действующих роботов. Тематические срезы пересекаются.'}
              </div>
        </section>

        <section className="ops-method">
          <div className="ops-section-heading">
            <div><span className="ops-kicker">ВЫБЕРИТЕ СВОЙ ШАГ</span><h2>С чего начать?</h2></div>
            <p>Если пока не знаете, какой процесс роботизировать, начните с площадки целиком.</p>
          </div>
          <div className="ops-track-list" aria-label="Выберите рабочий маршрут">
            {TRACKS.map(({ n, title, who, text, href, icon: Icon, tag, testid }) => (
              <Link className={`ops-track${n === '01' ? ' ops-track-primary' : ''}`} href={href} key={n} data-testid={testid}>
                <Mark n={n} /><div className="ops-track-icon"><Icon size={23} /></div>
                <div className="ops-track-main"><span className="ops-track-who">{who}</span><h3>{title}</h3><p>{text}</p></div>
                <div className="ops-track-end"><span>{tag}</span><b aria-hidden="true">↗</b></div>
              </Link>
            ))}
          </div>
        </section>

        <section className="ops-process-note" data-testid="home-process-note">
          <div><span className="ops-kicker">БЕЗ ЦИФР ПО ОДНОЙ ПЛОЩАДИ</span><h2>Сначала — процесс.</h2></div>
          <p>Для склада важны потоки, маршруты и режим работы. Расчёт парка и экономики имеет смысл для конкретной задачи и выбранного решения.</p>
          <Link href="/start" data-testid="home-process-note-link">Перейти к площадке <span aria-hidden="true">↗</span></Link>
        </section>

        <section className="ops-industries">
          <div className="ops-industries-title"><span className="ops-kicker">РАЗНЫЕ ПРОЦЕССЫ — РАЗНЫЕ ОГРАНИЧЕНИЯ</span><h2>Роботизация<br />не заканчивается складом.</h2><p>Изучайте карту применений по базовым отраслям. Число записей не означает число внедрений.</p><Link href="/map" data-testid="link-open-map">Перейти к карте отраслей <span aria-hidden="true">↗</span></Link></div>
          <div className="ops-industry-grid" data-testid="home-industries">
            {error ? (
              <p className="ops-industries-error" role="status" data-testid="home-industries-error">
                Не удалось загрузить отрасли из карты. Обновите страницу, чтобы попробовать снова.
              </p>
            ) : industries.map((industry, index) => (
              <Link href={`/quick-select?sector=${encodeURIComponent(industry.id)}`} key={industry.id} className="ops-industry" data-testid={`home-industry-${industry.id}`}>
                <span className="ops-industry-index">{String(index + 1).padStart(2, '0')}</span>
                <span className="ops-industry-name">{industry.id}</span>
                <span className="ops-industry-count">{industry.n} записей</span>
                <b aria-hidden="true">↗</b>
              </Link>
            ))}
          </div>
          <div className="ops-industry-foot"><IconOperations size={18} />{sectors ? industries.length : '…'} базовых отраслей · тематические срезы пересекаются и не означают новые внедрения</div>
        </section>

        <PartnerStrip />

        <section className="ops-closing">
          <div className="ops-closing-mark"><IconRobotAmr size={28} /></div>
          <div><span className="ops-kicker">ПРИНЯТИЕ РЕШЕНИЯ НАЧИНАЕТСЯ С ВХОДНЫХ ДАННЫХ</span><h2>Поставьте задачу.<br /><em>Проверьте допущения.</em></h2></div>
          <Link href="/start" className="ops-button-primary" data-testid="cta-closing-start">Начать с объекта <span aria-hidden="true">↗</span></Link>
        </section>
      </main>
    </div>
  );
}
