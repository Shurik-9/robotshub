export default function Home() {
  const mapUrl = `${import.meta.env.BASE_URL}map/index.html`;

  return (
    <section className="relative flex min-h-0 flex-1 bg-[#0A101D]" data-testid="page-robotization-map">
      <h1 className="sr-only">Интерактивная карта роботизации</h1>
      <iframe
        src={mapUrl}
        title="Карта роботизации: решения по отраслям, применениям и зрелости"
        className="absolute inset-0 h-full w-full border-0"
        loading="eager"
        data-testid="iframe-robotization-map"
      />
      <noscript>
        <div className="absolute inset-0 flex items-center justify-center p-8 text-center text-slate-200">
          Для работы интерактивной карты включите JavaScript в браузере.
        </div>
      </noscript>
    </section>
  );
}