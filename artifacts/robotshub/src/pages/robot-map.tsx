import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDemoTour } from '@/components/demo-tour';

const MAP_LINKS = [
  ['Торговля и услуги', 'Роботизация торговли и услуг'],
  ['Промышленность', 'Роботизация промышленности'],
  ['Транспорт и логистика', 'Роботизация транспорта и логистики'],
  ['Сельское хозяйство', 'Роботизация сельского хозяйства'],
  ['Строительство', 'Роботизация строительства'],
  ['Безопасность', 'Роботизация безопасности'],
];

export default function RobotMap() {
  const mapUrl = `${import.meta.env.BASE_URL}map/index.html`;
  const { start } = useDemoTour();
  const [buttonHost, setButtonHost] = useState<HTMLElement | null>(null);

  useEffect(() => () => buttonHost?.remove(), [buttonHost]);

  const attachButton = (iframe: HTMLIFrameElement) => {
    const heading = iframe.contentDocument?.querySelector('header.hero h1');
    if (!heading || heading.querySelector('[data-robotshub-tour-host]')) return;
    const host = iframe.contentDocument!.createElement('span');
    host.dataset.robotshubTourHost = 'true';
    host.style.cssText = 'display:inline-flex;vertical-align:middle;margin:8px 0 8px 18px';
    heading.appendChild(host);
    setButtonHost(host);
  };

  return (
    <section className="relative flex min-h-0 flex-1 bg-[#0A101D]" data-testid="page-robotization-map">
      <h1 className="sr-only">Интерактивная карта роботизации</h1>
      <div className="sr-only">
        <p>
          Карта объединяет 223 записи по девяти исходным отраслям: работающие внедрения, пилоты и разработки.
          Показаны промышленность, транспорт и логистика, торговля и услуги, энергетика, сельское хозяйство,
          строительство, безопасность, ЖКХ и лесное хозяйство.
        </p>
        <p>Выберите отрасль на карте, чтобы увидеть проекты, статусы, оборудование и ссылки на каталог решений.</p>
        <ul>
          {MAP_LINKS.map(([industry, label]) => (
            <li key={industry}><a href={`/quick-select?sector=${encodeURIComponent(industry)}`}>{label}</a></li>
          ))}
        </ul>
      </div>
      {buttonHost && createPortal(
        <button type="button" onClick={start} data-testid="button-start-demo"
          style={{ background: '#3BE68F', color: '#0A101D', border: 0, borderRadius: 8, padding: '11px 18px', fontSize: 15, fontWeight: 750, cursor: 'pointer', boxShadow: '0 4px 24px rgba(59,230,143,.25)' }}>
          Посмотреть демо
        </button>, buttonHost)}
      <iframe
        src={mapUrl}
        title="Карта роботизации: решения по отраслям, применениям и зрелости"
        className="absolute inset-0 h-full w-full border-0"
        loading="eager"
        data-testid="iframe-robotization-map"
        onLoad={event => attachButton(event.currentTarget)}
      />
      <noscript>
        <div className="absolute inset-0 flex items-center justify-center p-8 text-center text-slate-200">
          Для работы интерактивной карты включите JavaScript в браузере.
        </div>
      </noscript>
    </section>
  );
}
